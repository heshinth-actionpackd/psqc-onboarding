import { describe, expect, it } from "vitest";
import { idempotencyKeyFor } from "../src/channels/idempotency.js";
import { runTurn } from "../src/conversation/run-turn.js";
import type { BatchOption } from "../src/domain.js";
import { inbound } from "./fixture.js";
import { MemoryStore } from "./memory-store.js";

const batches: BatchOption[] = [
  { course: "fundamental", batch: "upcoming", sessionDetails: "Monday 7pm." },
];

describe("duplicate inbound events", () => {
  it("applies an event once and resends the same replies until it is marked processed", async () => {
    const store = new MemoryStore({ batches });

    const first = await runTurn(store, inbound({ eventId: "evt_1", text: "Hi PSQC" }));
    expect(first.deliver).toBe(true);
    expect(first.step).toBe("awaiting_name");

    const retry = await runTurn(store, inbound({ eventId: "evt_1", text: "Hi PSQC" }));
    expect(retry.deliver).toBe(true);
    expect(retry.replies).toEqual(first.replies);
    expect(store.studentWrites).toBe(1);

    await store.markEventProcessed("evt_1");
    const duplicate = await runTurn(store, inbound({ eventId: "evt_1", text: "Grace Hopper" }));
    expect(duplicate).toEqual({ deliver: false, replies: [], step: null });

    const next = await runTurn(store, inbound({ eventId: "evt_2", text: "Grace Hopper" }));
    expect(next.step).toBe("awaiting_email");
    expect(next.replies[0]?.kind === "text" && next.replies[0].body).toContain("Grace Hopper");
    expect(store.studentWrites).toBe(2);

    const replayName = await runTurn(store, inbound({ eventId: "evt_2", text: "Grace Hopper" }));
    expect(replayName.replies).toEqual(next.replies);
    expect(replayName.step).toBe("awaiting_email");
    expect(store.studentWrites).toBe(2);
  });

  it("builds a stable Actionpackd idempotency key from the event id", () => {
    expect(idempotencyKeyFor("evt_1", 0)).toBe("evt_1:0");
    expect(idempotencyKeyFor("has spaces", 1)).toMatch(/^evt_[0-9a-f]{48}_1$/);
  });
});
