import type { BatchOption, ChannelId, Reply, StoredEvent, StudentRecord } from "./domain.js";

export type BeginEventResult = { status: "new" } | { status: "existing"; event: StoredEvent };

/**
 * Work inside one transaction. Postgres holds an advisory lock per student;
 * the in-memory store used by tests runs each transaction to completion.
 */
export interface OnboardingTx {
  lockStudent(channel: ChannelId, channelUserId: string): Promise<void>;
  beginEvent(eventId: string, channel: ChannelId): Promise<BeginEventResult>;
  saveEventReplies(eventId: string, replies: Reply[]): Promise<void>;
  getStudent(channel: ChannelId, channelUserId: string): Promise<StudentRecord | null>;
  saveStudent(student: StudentRecord): Promise<void>;
  listActiveBatches(): Promise<BatchOption[]>;
}

export interface OnboardingStore {
  transact<T>(fn: (tx: OnboardingTx) => Promise<T>): Promise<T>;
  markEventProcessed(eventId: string): Promise<void>;
  ping(): Promise<void>;
}
