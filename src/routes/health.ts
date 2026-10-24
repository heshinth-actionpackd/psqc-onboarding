import type { FastifyInstance } from "fastify";
import type { OnboardingStore } from "../store.js";

export function registerHealthRoutes(app: FastifyInstance, store: OnboardingStore): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (request, reply) => {
    try {
      await store.ping();
    } catch (error) {
      request.log.error({ err: error }, "readiness check failed");
      return reply.code(503).send({ status: "unavailable" });
    }
    return { status: "ok" };
  });
}
