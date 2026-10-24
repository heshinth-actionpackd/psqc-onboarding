import { describe, expect, it } from "vitest";
import type { ChannelAdapter, OutboundDelivery } from "../src/channels/adapter.js";
import { ChannelRegistry } from "../src/channels/registry.js";
import { buildApp } from "../src/app.js";
import { signBody, testConfig } from "./fixture.js";
import { MemoryStore } from "./memory-store.js";

class FakeWhatsApp implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly sent: OutboundDelivery[] = [];
  fail = false;

  async send(delivery: OutboundDelivery): Promise<void> {
    if (this.fail) throw new Error("send failed");
    this.sent.push(delivery);
  }
}

async function setup() {
  const store = new MemoryStore({
    batches: [{ course: "fundamental", batch: "upcoming", sessionDetails: "Monday 7pm." }],
  });
  const whatsapp = new FakeWhatsApp();
  const app = await buildApp({
    config: testConfig,
    store,
    channels: new ChannelRegistry([whatsapp]),
    logger: false,
  });
  return { app, store, whatsapp };
}

function signed(body: unknown, secret = testConfig.ACTIONPACKD_WEBHOOK_SECRET) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    payload: raw,
    headers: {
      "content-type": "application/json",
      "x-actionpackd-timestamp": timestamp,
      "x-actionpackd-signature-v2": signBody(secret, raw, Number(timestamp)),
    },
  };
}

describe("webhook and health routes", () => {
  it("reports liveness without a database and readiness from the store", async () => {
    const { app } = await setup();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);

    const failing = await buildApp({
      config: testConfig,
      store: new MemoryStore({ ping: async () => Promise.reject(new Error("db down")) }),
      channels: new ChannelRegistry([]),
      logger: false,
    });
    const down = await failing.inject({ method: "GET", url: "/ready" });
    expect(down.statusCode).toBe(503);
    await app.close();
    await failing.close();
  });

  it("rejects a bad signature before it touches the conversation", async () => {
    const { app, store, whatsapp } = await setup();
    const body = signed({ id: "evt_1", type: "message.inbound" });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/actionpackd",
      headers: { ...body.headers, "x-actionpackd-signature-v2": "deadbeef" },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_signature" });
    expect(store.studentWrites).toBe(0);
    expect(whatsapp.sent).toHaveLength(0);
    await app.close();
  });

  it("starts onboarding from Hi PSQC and ignores a duplicate delivery", async () => {
    const { app, store, whatsapp } = await setup();
    const request = signed({
      id: "evt_1",
      type: "message.inbound",
      data: { message: { from: "919876543210", type: "text", text: { body: "Hi PSQC" } } },
    });
    const first = await app.inject({
      method: "POST",
      url: "/webhooks/actionpackd",
      headers: request.headers,
      payload: request.payload,
    });
    expect(first.statusCode).toBe(200);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]?.idempotencyKey).toBe("evt_1:0");
    expect(whatsapp.sent[0]?.reply.kind).toBe("text");

    const second = await app.inject({
      method: "POST",
      url: "/webhooks/actionpackd",
      headers: request.headers,
      payload: request.payload,
    });
    expect(second.statusCode).toBe(200);
    expect(whatsapp.sent).toHaveLength(1);
    expect(store.studentWrites).toBe(1);
    const student = await store.getStudent("whatsapp", "919876543210");
    expect(student?.currentStep).toBe("awaiting_name");
    await app.close();
  });

  it("keeps the event retryable when the send fails", async () => {
    const { app, store, whatsapp } = await setup();
    whatsapp.fail = true;
    const request = signed({
      id: "evt_9",
      type: "message.inbound",
      data: { message: { from: "919876543210", type: "text", text: { body: "Hi PSQC" } } },
    });
    const failed = await app.inject({
      method: "POST",
      url: "/webhooks/actionpackd",
      headers: request.headers,
      payload: request.payload,
    });
    expect(failed.statusCode).toBe(500);
    expect(store.events.get("evt_9")?.status).toBe("processing");

    whatsapp.fail = false;
    const retried = await app.inject({
      method: "POST",
      url: "/webhooks/actionpackd",
      headers: request.headers,
      payload: request.payload,
    });
    expect(retried.statusCode).toBe(200);
    expect(whatsapp.sent).toHaveLength(1);
    expect(store.events.get("evt_9")?.status).toBe("processed");
    expect(store.studentWrites).toBe(1);
    await app.close();
  });

  it("records a status event without creating a student", async () => {
    const { app, store, whatsapp } = await setup();
    const request = signed({
      id: "evt_status",
      type: "message.status",
      data: { status: { status: "delivered" } },
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/actionpackd",
      headers: request.headers,
      payload: request.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(store.students.size).toBe(0);
    expect(store.events.get("evt_status")?.status).toBe("processed");
    expect(whatsapp.sent).toHaveLength(0);
    await app.close();
  });
});
