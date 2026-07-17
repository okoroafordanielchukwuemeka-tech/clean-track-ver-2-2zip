import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: (process.env.EXTERNAL_DATABASE_URL ?? process.env.DATABASE_URL)!,
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
});
