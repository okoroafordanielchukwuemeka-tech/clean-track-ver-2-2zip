/**
 * Phase D — Environment Validation
 *
 * Validates all required environment variables at startup.
 * The server MUST NOT start if any required variable is missing.
 * No silent fallbacks. No defaults. Fail loudly.
 */

interface EnvRequirement {
  key: string;
  description: string;
  required: boolean;
}

const ENV_REQUIREMENTS: EnvRequirement[] = [
  {
    key: "DATABASE_URL",
    description: "PostgreSQL connection string for all business data",
    required: true,
  },
  {
    key: "JWT_SECRET",
    description: "Secret key for signing owner and worker authentication tokens",
    required: true,
  },
  {
    key: "SESSION_SECRET",
    description: "Secret key for session integrity and future session-store signing",
    required: true,
  },
  {
    key: "BACKUP_SECRET",
    description: "Secret key for HMAC-signing backup manifests (tamper detection)",
    required: true,
  },
];

const ENV_WARNINGS: EnvRequirement[] = [
  {
    key: "ALLOWED_ORIGINS",
    description: "Comma-separated list of allowed CORS origins. All origins allowed if unset — NOT safe for production.",
    required: false,
  },
  {
    key: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    description: "Meta webhook verification token. Webhooks not verified if unset.",
    required: false,
  },
];

/**
 * Validates the environment. Throws a descriptive error (terminating the process)
 * if any required variable is missing or empty.
 *
 * Logs warnings for optional-but-recommended variables.
 */
export function validateEnvironment(): void {
  console.log("[env] Validating environment variables...");

  const missing: string[] = [];

  for (const req of ENV_REQUIREMENTS) {
    const val = process.env[req.key];
    if (!val || val.trim() === "") {
      missing.push(`  ✗ ${req.key} — ${req.description}`);
    } else {
      console.log(`[env]   ✓ ${req.key}`);
    }
  }

  if (missing.length > 0) {
    const lines = [
      "",
      "╔══════════════════════════════════════════════════════════════╗",
      "║           FATAL: MISSING REQUIRED ENVIRONMENT VARIABLES      ║",
      "╚══════════════════════════════════════════════════════════════╝",
      "",
      "The following required environment variables are not set:",
      "",
      ...missing,
      "",
      "Set these variables in Replit Secrets (or your deployment environment)",
      "before starting the server. The server will NOT start without them.",
      "",
    ];
    console.error(lines.join("\n"));
    process.exit(1);
  }

  // Validate JWT_SECRET strength
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    console.error(
      "[env] FATAL: JWT_SECRET is too short. Minimum 32 characters required for security."
    );
    process.exit(1);
  }

  // Validate BACKUP_SECRET strength
  const backupSecret = process.env.BACKUP_SECRET!;
  if (backupSecret.length < 32) {
    console.error(
      "[env] FATAL: BACKUP_SECRET is too short. Minimum 32 characters required."
    );
    process.exit(1);
  }

  // Warnings for optional but recommended vars
  for (const warn of ENV_WARNINGS) {
    const val = process.env[warn.key];
    if (!val || val.trim() === "") {
      console.warn(`[env] ⚠ WARNING: ${warn.key} not set — ${warn.description}`);
    }
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !process.env.ALLOWED_ORIGINS) {
    console.error(
      "[env] FATAL: ALLOWED_ORIGINS must be set in production. CORS will accept all origins otherwise."
    );
    process.exit(1);
  }

  console.log("[env] ✓ Environment validation passed.\n");
}
