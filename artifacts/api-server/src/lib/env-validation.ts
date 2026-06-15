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
    description: "Secret key for AES-256 backup encryption and HMAC-signing backup manifests",
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
  {
    key: "WHATSAPP_APP_SECRET",
    description: "Meta App Secret for X-Hub-Signature-256 webhook payload verification. Highly recommended in production.",
    required: false,
  },
  {
    key: "BACKUP_OFFSITE_PROVIDER",
    description: "Off-site backup provider (r2|s3|b2). Off-site backups disabled if unset.",
    required: false,
  },
];

// Off-site provider credential requirements (checked only when provider is set)
const OFFSITE_ENV_GROUPS: Record<string, string[]> = {
  r2: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
  s3: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET_NAME"],
  b2: ["B2_KEY_ID", "B2_APP_KEY", "B2_ENDPOINT", "B2_BUCKET_NAME"],
};

/**
 * Validates the environment. Calls process.exit(1) with a descriptive error
 * if any required variable is missing or weak.
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

  // Validate secret strength
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    console.error(
      "[env] FATAL: JWT_SECRET is too short. Minimum 32 characters required for security."
    );
    process.exit(1);
  }

  const backupSecret = process.env.BACKUP_SECRET!;
  if (backupSecret.length < 32) {
    console.error(
      "[env] FATAL: BACKUP_SECRET is too short. Minimum 32 characters required for AES-256."
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

  // If off-site provider is set, validate its credentials
  const offsiteProvider = process.env.BACKUP_OFFSITE_PROVIDER?.toLowerCase();
  if (offsiteProvider) {
    const required = OFFSITE_ENV_GROUPS[offsiteProvider];
    if (!required) {
      console.warn(
        `[env] ⚠ WARNING: Unknown BACKUP_OFFSITE_PROVIDER="${offsiteProvider}". ` +
        `Supported: r2, s3, b2`
      );
    } else {
      const missingCreds = required.filter((k) => !process.env[k]?.trim());
      if (missingCreds.length > 0) {
        console.warn(
          `[env] ⚠ WARNING: BACKUP_OFFSITE_PROVIDER=${offsiteProvider} is set but ` +
          `missing credentials: ${missingCreds.join(", ")}. Off-site backups will be skipped.`
        );
      } else {
        console.log(`[env]   ✓ Off-site backup provider: ${offsiteProvider}`);
      }
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
