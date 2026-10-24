export const CHANNELS = ["whatsapp"] as const;
export type ChannelId = (typeof CHANNELS)[number];

export const COURSES = ["fundamental", "advanced"] as const;
export type Course = (typeof COURSES)[number];

export const STEPS = [
  "new",
  "awaiting_name",
  "awaiting_email",
  "awaiting_college",
  "awaiting_course",
  "awaiting_batch",
  "completed",
] as const;
export type Step = (typeof STEPS)[number];

/** Channel-agnostic reply. Adapters decide how to deliver it. */
export type Reply =
  | { kind: "text"; body: string }
  | { kind: "template"; templateName: string; language: string; bodyParams?: string[] };

/** Normalized inbound turn. */
export interface InboundMessage {
  channel: ChannelId;
  eventId: string;
  channelUserId: string;
  phone: string | null;
  text: string | null;
  buttonId: string | null;
}

export interface StudentRecord {
  name: string | null;
  phone: string;
  email: string | null;
  college: string | null;
  course: Course | null;
  batch: string | null;
  channel: ChannelId;
  channelUserId: string;
  currentStep: Step;
}

export interface BatchOption {
  course: Course;
  batch: string;
  sessionDetails: string;
}

export interface StoredEvent {
  eventId: string;
  channel: ChannelId;
  status: "processing" | "processed";
  replies: Reply[];
}

export function isChannelId(value: string): value is ChannelId {
  return (CHANNELS as readonly string[]).includes(value);
}

export function isCourse(value: string): value is Course {
  return (COURSES as readonly string[]).includes(value);
}

export function isStep(value: string): value is Step {
  return (STEPS as readonly string[]).includes(value);
}

export function courseLabel(course: Course): string {
  return course === "fundamental" ? "Fundamental" : "Advanced";
}
