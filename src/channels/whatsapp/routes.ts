import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { idempotencyKeyFor } from "../idempotency.js";
import type { ChannelRegistry } from "../registry.js";
import { runTurn } from "../../conversation/run-turn.js";
import type { OnboardingStore } from "../../store.js";
import { parseActionpackdWebhook } from "./parse.js";
import { verifyActionpackdSignature } from "./signature.js";

export const ACTIONPACKD_WEBHOOK_PATH = "/webhooks/actionpackd";

export function registerWhatsappWebhook(
  app: FastifyInstance,
  deps: { config: AppConfig; store: OnboardingStore; channels: ChannelRegistry },
): void {
  app.post(ACTIONPACKD_WEBHOOK_PATH, async (request, reply) => {
    const rawBody = request.rawBody;
    const verdict = verifyActionpackdSignature({
      rawBody: rawBody ?? Buffer.alloc(0),
      signatureHeader: request.headers["x-actionpackd-signature-v2"],
      timestampHeader: request.headers["x-actionpackd-timestamp"],
      secret: deps.config.ACTIONPACKD_WEBHOOK_SECRET,
    });
    if (!verdict.ok || !rawBody) {
      request.log.warn(
        { reason: verdict.ok ? "missing_body" : verdict.reason },
        "rejected webhook",
      );
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const parsed = parseActionpackdWebhook(request.body);
    if (parsed.kind === "invalid") {
      request.log.warn({ reason: parsed.reason }, "unreadable inbound webhook");
      return reply.code(400).send({ error: parsed.reason });
    }
    if (parsed.kind === "ignore") {
      request.log.info({ eventId: parsed.eventId, type: parsed.type }, "ignored webhook");
      return reply.code(200).send({ ok: true, ignored: true });
    }
    if (parsed.kind === "status") {
      await recordStatus(deps.store, parsed.eventId);
      request.log.info({ eventId: parsed.eventId }, "recorded status webhook");
      return reply.code(200).send({ ok: true });
    }

    const message = parsed.message;
    const outcome = await runTurn(deps.store, message);
    request.log.info(
      {
        eventId: message.eventId,
        deliver: outcome.deliver,
        replies: outcome.replies.length,
        step: outcome.step,
      },
      "handled inbound message",
    );
    if (!outcome.deliver) return reply.code(200).send({ ok: true });

    const adapter = deps.channels.require(message.channel);
    try {
      for (const [index, messageReply] of outcome.replies.entries()) {
        await adapter.send({
          to: message.channelUserId,
          reply: messageReply,
          idempotencyKey: idempotencyKeyFor(message.eventId, index),
        });
      }
    } catch (error) {
      request.log.error({ err: error, eventId: message.eventId }, "outbound send failed");
      return reply.code(500).send({ error: "send_failed" });
    }

    await deps.store.markEventProcessed(message.eventId);
    return reply.code(200).send({ ok: true });
  });
}

async function recordStatus(store: OnboardingStore, eventId: string): Promise<void> {
  await store.transact(async (tx) => {
    const begun = await tx.beginEvent(eventId, "whatsapp");
    if (begun.status === "new") await tx.saveEventReplies(eventId, []);
  });
  await store.markEventProcessed(eventId);
}
