import type { InboundMessage, Reply, Step, StudentRecord } from "../domain.js";
import type { OnboardingStore } from "../store.js";
import { blankState, transition, type ConversationState } from "./machine.js";

export interface TurnOutcome {
  /** False when this event id was already finished. Callers must not send again. */
  deliver: boolean;
  replies: Reply[];
  step: Step | null;
}

/**
 * Applies one inbound message. A duplicate event id does not move the student:
 * a retry while sends are still outstanding returns the original replies, and a
 * retry after they were marked processed returns nothing.
 */
export async function runTurn(
  store: OnboardingStore,
  message: InboundMessage,
): Promise<TurnOutcome> {
  return store.transact(async (tx) => {
    await tx.lockStudent(message.channel, message.channelUserId);
    const begun = await tx.beginEvent(message.eventId, message.channel);
    if (begun.status === "existing") {
      if (begun.event.status === "processed") {
        return { deliver: false, replies: [], step: null };
      }
      const student = await tx.getStudent(message.channel, message.channelUserId);
      return { deliver: true, replies: begun.event.replies, step: student?.currentStep ?? null };
    }

    const existing = await tx.getStudent(message.channel, message.channelUserId);
    const phone = message.phone ?? existing?.phone ?? message.channelUserId;
    const state = existing ? studentToState(existing, phone) : blankState(phone);
    const batches = await tx.listActiveBatches();
    const result = transition(
      state,
      { text: message.text, buttonId: message.buttonId },
      { batches },
    );
    await tx.saveStudent({
      channel: message.channel,
      channelUserId: message.channelUserId,
      phone: result.state.phone,
      name: result.state.name,
      email: result.state.email,
      college: result.state.college,
      course: result.state.course,
      batch: result.state.batch,
      currentStep: result.state.step,
    });
    await tx.saveEventReplies(message.eventId, result.replies);
    return { deliver: true, replies: result.replies, step: result.state.step };
  });
}

function studentToState(student: StudentRecord, phone: string): ConversationState {
  return {
    step: student.currentStep,
    phone,
    name: student.name,
    email: student.email,
    college: student.college,
    course: student.course,
    batch: student.batch,
  };
}
