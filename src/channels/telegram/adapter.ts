import type { ChannelAdapter, OutboundDelivery } from "../adapter.js";

/**
 * Placeholder. The conversation core already speaks InboundMessage / Reply,
 * so a Telegram webhook can call runTurn and this adapter later without
 * changing the step machine.
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;

  send(_delivery: OutboundDelivery): Promise<void> {
    return Promise.reject(new Error("Telegram adapter is not implemented"));
  }
}
