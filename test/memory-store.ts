import type { BatchOption, ChannelId, Reply, StoredEvent, StudentRecord } from "../src/domain.js";
import type { BeginEventResult, OnboardingStore, OnboardingTx } from "../src/store.js";

interface Snapshot {
  students: Map<string, StudentRecord>;
  events: Map<string, StoredEvent>;
  studentWrites: number;
}

/** Test double with the same claim / rollback behavior as the Postgres store. */
export class MemoryStore implements OnboardingStore, OnboardingTx {
  students = new Map<string, StudentRecord>();
  events = new Map<string, StoredEvent>();
  batches: BatchOption[];
  studentWrites = 0;
  private readonly pingImpl: () => Promise<void>;

  constructor(options?: { batches?: BatchOption[]; ping?: () => Promise<void> }) {
    this.batches = (options?.batches ?? []).map((batch) => ({ ...batch }));
    this.pingImpl = options?.ping ?? (async () => undefined);
  }

  async ping(): Promise<void> {
    await this.pingImpl();
  }

  async transact<T>(fn: (tx: OnboardingTx) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  async lockStudent(): Promise<void> {}

  async beginEvent(eventId: string, channel: ChannelId): Promise<BeginEventResult> {
    const existing = this.events.get(eventId);
    if (existing) return { status: "existing", event: cloneEvent(existing) };
    this.events.set(eventId, { eventId, channel, status: "processing", replies: [] });
    return { status: "new" };
  }

  async saveEventReplies(eventId: string, replies: Reply[]): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) throw new Error(`unknown event ${eventId}`);
    event.replies = replies.map(cloneReply);
  }

  async getStudent(channel: ChannelId, channelUserId: string): Promise<StudentRecord | null> {
    const student = this.students.get(studentKey(channel, channelUserId));
    return student ? { ...student } : null;
  }

  async saveStudent(student: StudentRecord): Promise<void> {
    this.studentWrites += 1;
    this.students.set(studentKey(student.channel, student.channelUserId), { ...student });
  }

  async listActiveBatches(): Promise<BatchOption[]> {
    return this.batches.map((batch) => ({ ...batch }));
  }

  async markEventProcessed(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) return;
    event.status = "processed";
  }

  private snapshot(): Snapshot {
    return {
      students: new Map([...this.students].map(([key, student]) => [key, { ...student }])),
      events: new Map([...this.events].map(([key, event]) => [key, cloneEvent(event)])),
      studentWrites: this.studentWrites,
    };
  }

  private restore(snapshot: Snapshot): void {
    this.students = snapshot.students;
    this.events = snapshot.events;
    this.studentWrites = snapshot.studentWrites;
  }
}

function studentKey(channel: ChannelId, channelUserId: string): string {
  return `${channel}:${channelUserId}`;
}

function cloneEvent(event: StoredEvent): StoredEvent {
  return { ...event, replies: event.replies.map(cloneReply) };
}

function cloneReply(reply: Reply): Reply {
  if (reply.kind === "text") return { ...reply };
  return {
    kind: "template",
    templateName: reply.templateName,
    language: reply.language,
    ...(reply.bodyParams ? { bodyParams: [...reply.bodyParams] } : {}),
  };
}
