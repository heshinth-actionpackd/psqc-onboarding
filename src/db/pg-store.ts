import type { Pool, PoolClient } from "pg";
import {
  isChannelId,
  isCourse,
  isStep,
  type BatchOption,
  type ChannelId,
  type Reply,
  type StoredEvent,
  type StudentRecord,
} from "../domain.js";
import type { BeginEventResult, OnboardingStore, OnboardingTx } from "../store.js";

interface StudentRow {
  name: string | null;
  phone: string;
  email: string | null;
  college: string | null;
  course: string | null;
  batch: string | null;
  channel: string;
  channel_user_id: string;
  current_step: string;
}

interface EventRow {
  event_id: string;
  channel: string;
  status: string;
  replies: unknown;
}

interface BatchRow {
  course: string;
  batch: string;
  session_details: string;
}

class PgTx implements OnboardingTx {
  constructor(private readonly client: PoolClient) {}

  async lockStudent(channel: ChannelId, channelUserId: string): Promise<void> {
    // Serializes turns for one person so two different messages cannot both
    // read the same step and overwrite each other.
    await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `${channel}:${channelUserId}`,
    ]);
  }

  async beginEvent(eventId: string, channel: ChannelId): Promise<BeginEventResult> {
    const inserted = await this.client.query<{ event_id: string }>(
      `INSERT INTO processed_events (event_id, channel, status, replies)
       VALUES ($1, $2, 'processing', '[]'::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, channel],
    );
    if ((inserted.rowCount ?? 0) > 0) return { status: "new" };

    const existing = await this.client.query<EventRow>(
      `SELECT event_id, channel, status, replies
       FROM processed_events
       WHERE event_id = $1`,
      [eventId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new Error(`processed event ${eventId} disappeared during claim`);
    }
    return { status: "existing", event: mapEvent(row) };
  }

  async saveEventReplies(eventId: string, replies: Reply[]): Promise<void> {
    await this.client.query(`UPDATE processed_events SET replies = $2::jsonb WHERE event_id = $1`, [
      eventId,
      JSON.stringify(replies),
    ]);
  }

  async getStudent(channel: ChannelId, channelUserId: string): Promise<StudentRecord | null> {
    const result = await this.client.query<StudentRow>(
      `SELECT name, phone, email, college, course, batch, channel, channel_user_id, current_step
       FROM students
       WHERE channel = $1 AND channel_user_id = $2`,
      [channel, channelUserId],
    );
    const row = result.rows[0];
    return row ? mapStudent(row) : null;
  }

  async saveStudent(student: StudentRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO students (
         name, phone, email, college, course, batch, channel, channel_user_id, current_step
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (channel, channel_user_id) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         college = EXCLUDED.college,
         course = EXCLUDED.course,
         batch = EXCLUDED.batch,
         current_step = EXCLUDED.current_step`,
      [
        student.name,
        student.phone,
        student.email,
        student.college,
        student.course,
        student.batch,
        student.channel,
        student.channelUserId,
        student.currentStep,
      ],
    );
  }

  async listActiveBatches(): Promise<BatchOption[]> {
    const result = await this.client.query<BatchRow>(
      `SELECT course, batch, session_details
       FROM course_batches
       WHERE active = TRUE
       ORDER BY course, batch`,
    );
    return result.rows.map(mapBatch);
  }
}

export function createPgStore(pool: Pool): OnboardingStore {
  return {
    async transact(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(new PgTx(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async markEventProcessed(eventId) {
      await pool.query(
        `UPDATE processed_events
         SET status = 'processed', processed_at = now()
         WHERE event_id = $1`,
        [eventId],
      );
    },
    async ping() {
      await pool.query("SELECT 1");
    },
  };
}

function mapStudent(row: StudentRow): StudentRecord {
  if (!isChannelId(row.channel)) throw new Error(`unexpected channel ${row.channel}`);
  if (!isStep(row.current_step)) throw new Error(`unexpected step ${row.current_step}`);
  if (row.course !== null && !isCourse(row.course))
    throw new Error(`unexpected course ${row.course}`);
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    college: row.college,
    course: row.course,
    batch: row.batch,
    channel: row.channel,
    channelUserId: row.channel_user_id,
    currentStep: row.current_step,
  };
}

function mapBatch(row: BatchRow): BatchOption {
  if (!isCourse(row.course)) throw new Error(`unexpected course ${row.course}`);
  return { course: row.course, batch: row.batch, sessionDetails: row.session_details };
}

function mapEvent(row: EventRow): StoredEvent {
  if (!isChannelId(row.channel)) throw new Error(`unexpected channel ${row.channel}`);
  if (row.status !== "processing" && row.status !== "processed") {
    throw new Error(`unexpected event status ${row.status}`);
  }
  return {
    eventId: row.event_id,
    channel: row.channel,
    status: row.status,
    replies: parseReplies(row.replies),
  };
}

function parseReplies(value: unknown): Reply[] {
  if (!Array.isArray(value)) return [];
  const replies: Reply[] = [];
  for (const item of value) {
    if (!isRecord(item) || (item.kind !== "text" && item.kind !== "template")) continue;
    if (item.kind === "text" && typeof item.body === "string") {
      replies.push({ kind: "text", body: item.body });
      continue;
    }
    if (
      item.kind === "template" &&
      typeof item.templateName === "string" &&
      typeof item.language === "string"
    ) {
      const bodyParams = Array.isArray(item.bodyParams)
        ? item.bodyParams.filter((param): param is string => typeof param === "string")
        : undefined;
      replies.push({
        kind: "template",
        templateName: item.templateName,
        language: item.language,
        ...(bodyParams && bodyParams.length > 0 ? { bodyParams } : {}),
      });
    }
  }
  return replies;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
