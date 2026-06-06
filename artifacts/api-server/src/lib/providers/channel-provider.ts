/**
 * Provider Abstraction Layer
 *
 * All communication providers (WhatsApp, SMS, Email) implement
 * the ChannelProvider interface so the dispatcher is fully
 * decoupled from any specific vendor.
 */

// ─── Send / Validate ─────────────────────────────────────────────────────────

export interface SendParams {
  phone: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  providerMessageId?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export interface WebhookStatusUpdate {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  recipientId?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface WebhookHandleResult {
  /** The provider's phone_number_id / sender ID — used to route to the correct tenant */
  phoneNumberId?: string;
  statusUpdates: WebhookStatusUpdate[];
}

// ─── Core interface ───────────────────────────────────────────────────────────

export interface ChannelProvider {
  /**
   * Send an outbound message.
   * Throws on failure — the dispatcher catches and records the error.
   */
  send(params: SendParams): Promise<SendResult>;

  /**
   * Parse an incoming webhook payload and extract status updates.
   * Must NOT throw — return empty statusUpdates on unrecognized payload.
   */
  handleWebhook(payload: unknown): WebhookHandleResult;

  /**
   * Validate the configuration by calling the provider API.
   * Does NOT throw — returns { valid: false, error } on failure.
   */
  validateConfiguration(): Promise<ValidationResult>;
}

// ─── Custom errors ────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly providerResponse?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
