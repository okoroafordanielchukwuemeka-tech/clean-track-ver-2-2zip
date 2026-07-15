/**
 * Paystack API Client — Phase 7.8 Payment Automation & Billing Infrastructure
 *
 * Thin wrapper around the Paystack REST API using Node 20's native fetch
 * (no SDK dependency, consistent with the WhatsApp Cloud provider pattern —
 * see WhatsApp Provider Integration in memory).
 *
 * GATEWAY DECISION: Paystack was chosen over Flutterwave — see
 * docs/billing-architecture.md Part 1 for the full comparison.
 *
 * RECURRING BILLING STRATEGY: rather than Paystack's native Plan/Subscription
 * objects (which hand dunning/retry logic to Paystack), CleanTrack charges a
 * saved, reusable card *authorization* directly via /transaction/charge_authorization
 * on each renewal date. This keeps grace periods, retry cadence, and lifecycle
 * emails fully under CleanTrack's control (see subscription-lifecycle.ts and
 * billing-service.ts), matching the existing trial/grace-period design instead
 * of delegating it to the provider. See docs/billing-architecture.md for detail.
 */

import crypto from "crypto";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return key;
}

export function isPaystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY && !!process.env.PAYSTACK_PUBLIC_KEY;
}

export function getPaystackPublicKey(): string {
  return process.env.PAYSTACK_PUBLIC_KEY ?? "";
}

class PaystackError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = "PaystackError";
  }
}

async function paystackRequest<T = any>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.status === false) {
    throw new PaystackError(
      json?.message ?? `Paystack request failed (${res.status})`,
      res.status,
      json
    );
  }

  return json as T;
}

export interface InitializeTransactionParams {
  email: string;
  amountNgn: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Starts a new hosted checkout transaction. Used for: first-time subscription
 * purchase, plan upgrade/downgrade, reactivation, and manual "retry payment"
 * when no saved card authorization exists yet.
 */
export async function initializeTransaction(
  params: InitializeTransactionParams
): Promise<InitializeTransactionResult> {
  const result = await paystackRequest<{
    data: { authorization_url: string; access_code: string; reference: string };
  }>("POST", "/transaction/initialize", {
    email: params.email,
    amount: Math.round(params.amountNgn * 100), // kobo
    reference: params.reference,
    callback_url: params.callbackUrl,
    currency: "NGN",
    metadata: params.metadata ?? {},
  });

  return {
    authorizationUrl: result.data.authorization_url,
    accessCode: result.data.access_code,
    reference: result.data.reference,
  };
}

export interface PaystackAuthorization {
  authorizationCode: string;
  last4: string;
  bank: string | null;
  cardType: string | null;
  reusable: boolean;
}

export interface VerifyTransactionResult {
  status: "success" | "failed" | "abandoned" | string;
  reference: string;
  amountNgn: number;
  paidAt: string | null;
  customerEmail: string;
  customerCode: string | null;
  authorization: PaystackAuthorization | null;
  metadata: Record<string, unknown>;
  gatewayResponse: string;
}

export async function verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
  const result = await paystackRequest<{ data: any }>(
    "GET",
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  const d = result.data;

  return {
    status: d.status,
    reference: d.reference,
    amountNgn: (d.amount ?? 0) / 100,
    paidAt: d.paid_at ?? null,
    customerEmail: d.customer?.email ?? "",
    customerCode: d.customer?.customer_code ?? null,
    authorization: d.authorization
      ? {
          authorizationCode: d.authorization.authorization_code,
          last4: d.authorization.last4,
          bank: d.authorization.bank ?? null,
          cardType: d.authorization.card_type ?? null,
          reusable: !!d.authorization.reusable,
        }
      : null,
    metadata: d.metadata ?? {},
    gatewayResponse: d.gateway_response ?? "",
  };
}

export interface ChargeAuthorizationParams {
  email: string;
  amountNgn: number;
  authorizationCode: string;
  reference: string;
  metadata?: Record<string, unknown>;
}

/**
 * Charges a previously-saved card authorization directly, with no customer
 * interaction. Used by the renewal scheduler to auto-bill subscriptions.
 */
export async function chargeAuthorization(
  params: ChargeAuthorizationParams
): Promise<VerifyTransactionResult> {
  const result = await paystackRequest<{ data: any }>(
    "POST",
    "/transaction/charge_authorization",
    {
      email: params.email,
      amount: Math.round(params.amountNgn * 100),
      authorization_code: params.authorizationCode,
      reference: params.reference,
      metadata: params.metadata ?? {},
    }
  );
  const d = result.data;

  return {
    status: d.status,
    reference: d.reference,
    amountNgn: (d.amount ?? 0) / 100,
    paidAt: d.paid_at ?? null,
    customerEmail: d.customer?.email ?? "",
    customerCode: d.customer?.customer_code ?? null,
    authorization: d.authorization
      ? {
          authorizationCode: d.authorization.authorization_code,
          last4: d.authorization.last4,
          bank: d.authorization.bank ?? null,
          cardType: d.authorization.card_type ?? null,
          reusable: !!d.authorization.reusable,
        }
      : null,
    metadata: d.metadata ?? {},
    gatewayResponse: d.gateway_response ?? "",
  };
}

/**
 * Verifies the Paystack webhook signature: HMAC-SHA512 of the raw request
 * body, keyed with the Paystack secret key, compared against the
 * `x-paystack-signature` header. Constant-time comparison to avoid timing
 * attacks — same idiom used for the WhatsApp X-Hub-Signature-256 check.
 */
export function verifyPaystackSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  try {
    const expected = crypto
      .createHmac("sha512", getSecretKey())
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signatureHeader, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export { PaystackError };
