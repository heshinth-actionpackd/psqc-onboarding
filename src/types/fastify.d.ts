import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Exact request bytes, kept so webhook HMAC is not computed over re-serialized JSON. */
    rawBody?: Buffer;
  }
}
