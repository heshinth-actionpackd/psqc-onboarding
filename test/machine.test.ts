import { describe, expect, it } from "vitest";
import { TEMPLATE_NAMES } from "../src/conversation/templates.js";
import { blankState, transition, type TurnContext } from "../src/conversation/machine.js";
import type { BatchOption } from "../src/domain.js";

const batches: BatchOption[] = [
  {
    course: "fundamental",
    batch: "upcoming",
    sessionDetails: "Fundamentals meet Monday at 7pm. Join link: https://example.com/f",
  },
  { course: "advanced", batch: "morning", sessionDetails: "Advanced morning details." },
  { course: "advanced", batch: "evening", sessionDetails: "Advanced evening details." },
];

const context: TurnContext = { batches };

describe("onboarding state machine", () => {
  it("moves from a first Hi PSQC into asking for a name", () => {
    const result = transition(
      blankState("919800000000"),
      { text: "Hi PSQC", buttonId: null },
      context,
    );

    expect(result.state.step).toBe("awaiting_name");
    expect(result.state.phone).toBe("919800000000");
    expect(result.state.name).toBeNull();
    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]).toMatchObject({ kind: "text" });
    expect(result.replies[0]?.kind === "text" && result.replies[0].body).toContain("full name");
  });

  it("asks for an email after a name, and rejects a bad email", () => {
    const named = transition(
      { ...blankState("919800000000"), step: "awaiting_name" },
      { text: "  Ada   Lovelace ", buttonId: null },
      context,
    );
    expect(named.state).toMatchObject({ step: "awaiting_email", name: "Ada Lovelace" });
    expect(named.replies[0]?.kind === "text" && named.replies[0].body).toContain("email");

    const rejected = transition(named.state, { text: "not-an-email", buttonId: null }, context);
    expect(rejected.state).toEqual(named.state);
    expect(rejected.replies[0]?.kind === "text" && rejected.replies[0].body).toContain("email");
  });

  it("asks for a course with the template, then confirms the open batch", () => {
    const college = transition(
      {
        ...blankState("919800000000"),
        step: "awaiting_college",
        name: "Ada Lovelace",
        email: "ada@college.edu",
      },
      { text: "City College", buttonId: null },
      context,
    );
    expect(college.state.step).toBe("awaiting_course");
    expect(college.state.college).toBe("City College");
    expect(college.replies[0]).toEqual({
      kind: "template",
      templateName: TEMPLATE_NAMES.courseChoice,
      language: "en",
    });

    const course = transition(
      college.state,
      { text: "Fundamental", buttonId: "fundamental" },
      context,
    );
    expect(course.state).toMatchObject({ step: "awaiting_batch", course: "fundamental" });
    expect(course.replies[0]?.kind === "text" && course.replies[0].body).toContain("YES");

    const confirmed = transition(course.state, { text: "yes", buttonId: null }, context);
    expect(confirmed.state).toMatchObject({ step: "completed", batch: "upcoming" });
    expect(confirmed.replies[0]?.kind === "text" && confirmed.replies[0].body).toContain(
      "https://example.com/f",
    );
  });

  it("requires a batch name when more than one batch is open", () => {
    const choosing = transition(
      {
        ...blankState("919800000000"),
        step: "awaiting_course",
        name: "Ada",
        email: "ada@college.edu",
        college: "City College",
      },
      { text: null, buttonId: "advanced" },
      context,
    );
    expect(choosing.state.step).toBe("awaiting_batch");

    const vague = transition(choosing.state, { text: "YES", buttonId: null }, context);
    expect(vague.state.step).toBe("awaiting_batch");

    const picked = transition(choosing.state, { text: "Evening", buttonId: null }, context);
    expect(picked.state).toMatchObject({ step: "completed", batch: "evening" });
  });

  it("restarts an in-progress chat from Hi PSQC and leaves a completed enrollment in place", () => {
    const restarted = transition(
      {
        ...blankState("919800000000"),
        step: "awaiting_email",
        name: "Ada",
      },
      { text: "hi psqc!", buttonId: null },
      context,
    );
    expect(restarted.state).toMatchObject({ step: "awaiting_name", name: null, email: null });

    const done = transition(
      {
        ...blankState("919800000000"),
        step: "completed",
        name: "Ada",
        email: "ada@college.edu",
        college: "City College",
        course: "fundamental",
        batch: "upcoming",
      },
      { text: "Hi PSQC", buttonId: null },
      context,
    );
    expect(done.state.name).toBe("Ada");
    expect(done.state.step).toBe("completed");
    expect(done.replies[0]?.kind === "text" && done.replies[0].body).toContain("already enrolled");
  });
});
