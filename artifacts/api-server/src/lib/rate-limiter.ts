/**
 * Phase E — Rate Limiting & Abuse Protection
 *
 * Provides per-route rate limiters using express-rate-limit.
 * All limits are IP-based. Limits are intentionally conservative
 * for a production SaaS serving real businesses.
 */

import rateLimit from "express-rate-limit";

const RATE_LIMIT_HEADERS = true;
const SKIP_SUCCESSFUL_REQUESTS = false;

/**
 * Auth endpoints: login, signup, PIN entry.
 * 10 attempts per 15 minutes per IP.
 * Blocks brute-force attacks on owner passwords and worker PINs.
 * Skips read-only session endpoints (e.g. /me) that are already JWT-protected.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  skipSuccessfulRequests: SKIP_SUCCESSFUL_REQUESTS,
  skip: (req) => req.path === "/me" || req.path === "/demo-login",
  message: {
    error: "Too many login attempts. Please wait 15 minutes before trying again.",
    retryAfter: 15 * 60,
  },
  handler: (req, res, _next, options) => {
    console.warn(`[rate-limit] Auth limit hit: ${req.ip} → ${req.path}`);
    res.status(429).json(options.message);
  },
});

/**
 * Demo login endpoint: generous limit so the demo is always accessible.
 * 60 requests per minute per IP — a single user refreshing the demo
 * repeatedly should never be blocked.
 */
export const demoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  message: {
    error: "Too many demo requests. Please wait a moment.",
    retryAfter: 60,
  },
});

/**
 * Password reset: 5 requests per 15 minutes per IP.
 * Prevents email enumeration abuse and protects the email sending budget.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    error: "Too many password reset requests. Please wait 15 minutes before trying again.",
    retryAfter: 15 * 60,
  },
  handler: (req, res, _next, options) => {
    console.warn(`[rate-limit] Password reset limit hit: ${req.ip}`);
    res.status(429).json(options.message);
  },
});

/**
 * General API: all authenticated business endpoints.
 * 300 requests per minute per IP.
 * Allows normal worker/owner usage while blocking scripted abuse.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please slow down.",
    retryAfter: 60,
  },
  handler: (req, res, _next, options) => {
    console.warn(`[rate-limit] API limit hit: ${req.ip} → ${req.path}`);
    res.status(429).json(options.message);
  },
});

/**
 * Webhook endpoints: Meta WhatsApp delivery callbacks.
 * 120 requests per minute per IP.
 * Meta sends bursts on message delivery events.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  message: {
    error: "Webhook rate limit exceeded.",
  },
  handler: (req, res, _next, options) => {
    console.warn(`[rate-limit] Webhook limit hit: ${req.ip}`);
    res.status(429).json(options.message);
  },
});

/**
 * Owner management routes: workers, branches, settings, financials.
 * 120 requests per minute per IP.
 */
export const ownerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  message: {
    error: "Too many requests on management routes.",
    retryAfter: 60,
  },
});

/**
 * Admin routes: platform admin command center.
 * 60 requests per minute per IP. Stricter since this is internal-only.
 */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  message: {
    error: "Admin rate limit exceeded.",
    retryAfter: 60,
  },
  handler: (req, res, _next, options) => {
    console.warn(`[rate-limit] Admin limit hit: ${req.ip} → ${req.path}`);
    res.status(429).json(options.message);
  },
});

/**
 * Recovery / backup endpoints: expensive server-side operations.
 * 5 requests per 10 minutes per IP.
 */
export const recoveryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: RATE_LIMIT_HEADERS,
  legacyHeaders: false,
  message: {
    error: "Too many backup/recovery requests. Wait 10 minutes.",
    retryAfter: 10 * 60,
  },
});
