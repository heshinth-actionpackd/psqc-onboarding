import { courseLabel, type BatchOption, type Course, type Reply, type Step } from "../domain.js";
import { copy } from "./copy.js";
import { TEMPLATE_NAMES } from "./templates.js";

export interface ConversationState {
  step: Step;
  phone: string;
  name: string | null;
  email: string | null;
  college: string | null;
  course: Course | null;
  batch: string | null;
}

export interface TurnInput {
  text: string | null;
  buttonId: string | null;
}

export interface TurnContext {
  batches: BatchOption[];
}

export interface TransitionResult {
  state: ConversationState;
  replies: Reply[];
}

const START_RE = /^\s*hi\s+psqc\b[.!]?\s*$/i;
const YES_RE = /^(yes|y|confirm|ok|okay)[.!]?\s*$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function blankState(phone: string): ConversationState {
  return {
    step: "new",
    phone,
    name: null,
    email: null,
    college: null,
    course: null,
    batch: null,
  };
}

export function transition(
  state: ConversationState,
  input: TurnInput,
  context: TurnContext,
): TransitionResult {
  if (isStart(input)) {
    if (state.step === "completed" && state.course && state.batch) {
      const details = findBatch(context.batches, state.course, state.batch)?.sessionDetails ?? null;
      return {
        state,
        replies: [
          {
            kind: "text",
            body: copy.alreadyEnrolled(courseLabel(state.course), state.batch, details),
          },
        ],
      };
    }
    return {
      state: { ...blankState(state.phone), step: "awaiting_name" },
      replies: [{ kind: "text", body: copy.welcomeAskName() }],
    };
  }

  switch (state.step) {
    case "new":
      return stay(state, copy.promptStart());
    case "awaiting_name": {
      const name = cleanName(input.text);
      if (!name) return stay(state, copy.invalidName());
      return {
        state: { ...state, name, step: "awaiting_email" },
        replies: [{ kind: "text", body: copy.askEmail(name) }],
      };
    }
    case "awaiting_email": {
      const email = cleanEmail(input.text);
      if (!email) return stay(state, copy.invalidEmail());
      return {
        state: { ...state, email, step: "awaiting_college" },
        replies: [{ kind: "text", body: copy.askCollege() }],
      };
    }
    case "awaiting_college": {
      const college = cleanCollege(input.text);
      if (!college) return stay(state, copy.invalidCollege());
      return {
        state: { ...state, college, course: null, batch: null, step: "awaiting_course" },
        replies: [courseChoiceTemplate()],
      };
    }
    case "awaiting_course": {
      const course = parseCourseChoice(input);
      if (!course) return stay(state, copy.invalidCourse());
      const open = context.batches.filter((batch) => batch.course === course);
      return {
        state: { ...state, course, batch: null, step: "awaiting_batch" },
        replies: [{ kind: "text", body: batchPrompt(course, open) }],
      };
    }
    case "awaiting_batch": {
      if (!state.course) return stay(state, copy.promptStart());
      const open = context.batches.filter((batch) => batch.course === state.course);
      const chosen = matchBatch(input, open);
      if (!chosen) return stay(state, copy.invalidBatch(open.map((batch) => batch.batch)));
      return {
        state: { ...state, batch: chosen.batch, step: "completed" },
        replies: [
          {
            kind: "text",
            body: copy.confirmed(courseLabel(state.course), chosen.batch, chosen.sessionDetails),
          },
        ],
      };
    }
    case "completed":
      return stay(state, completedNudge(state, context));
    default: {
      const unreachable: never = state.step;
      return unreachable;
    }
  }
}

function isStart(input: TurnInput): boolean {
  if (input.buttonId) return false;
  if (!input.text) return false;
  return START_RE.test(input.text);
}

function stay(state: ConversationState, body: string): TransitionResult {
  return { state, replies: [{ kind: "text", body }] };
}

function courseChoiceTemplate(): Reply {
  return {
    kind: "template",
    templateName: TEMPLATE_NAMES.courseChoice,
    language: "en",
  };
}

function batchPrompt(course: Course, open: BatchOption[]): string {
  const label = courseLabel(course);
  if (open.length === 0) return copy.noOpenBatch(label);
  const only = open[0];
  if (open.length === 1 && only) return copy.confirmBatch(label, only.batch);
  return copy.chooseBatch(
    label,
    open.map((batch) => batch.batch),
  );
}

function completedNudge(state: ConversationState, context: TurnContext): string {
  if (!state.course || !state.batch) return copy.promptStart();
  const details = findBatch(context.batches, state.course, state.batch)?.sessionDetails ?? null;
  return copy.alreadyEnrolled(courseLabel(state.course), state.batch, details);
}

function parseCourseChoice(input: TurnInput): Course | null {
  for (const value of [input.buttonId, input.text]) {
    if (!value) continue;
    const norm = value.trim().toLowerCase();
    if (norm === "fundamental" || norm === "course:fundamental") return "fundamental";
    if (norm === "advanced" || norm === "course:advanced") return "advanced";
  }
  return null;
}

function matchBatch(input: TurnInput, open: BatchOption[]): BatchOption | null {
  if (open.length === 0) return null;
  const fromButton = input.buttonId ? findByName(open, input.buttonId) : undefined;
  if (fromButton) return fromButton;
  const only = open[0];
  if (open.length === 1 && only && isYes(input.text)) return only;
  if (!input.text) return null;
  return findByName(open, input.text) ?? null;
}

function findByName(open: BatchOption[], value: string): BatchOption | undefined {
  const norm = value.trim().toLowerCase();
  return open.find(
    (batch) => batch.batch.toLowerCase() === norm || `batch:${batch.batch.toLowerCase()}` === norm,
  );
}

function findBatch(
  batches: BatchOption[],
  course: Course,
  batchName: string,
): BatchOption | undefined {
  return batches.find(
    (batch) => batch.course === course && batch.batch.toLowerCase() === batchName.toLowerCase(),
  );
}

function cleanName(text: string | null): string | null {
  if (!text) return null;
  const name = text.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) return null;
  return name;
}

function cleanEmail(text: string | null): string | null {
  if (!text) return null;
  const email = text.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function cleanCollege(text: string | null): string | null {
  if (!text) return null;
  const college = text.trim().replace(/\s+/g, " ");
  if (college.length < 1 || college.length > 120) return null;
  return college;
}

function isYes(text: string | null): boolean {
  if (!text) return false;
  return YES_RE.test(text.trim());
}
