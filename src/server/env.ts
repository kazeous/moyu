import { z } from "zod";

const appOriginSchema = z.url({ error: "APP_ORIGIN must be a valid URL" });

const rawEnvSchema = z.object({
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a valid URL" }).refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    },
    { error: "DATABASE_URL must use postgres or postgresql" },
  ),
  APP_ORIGIN: appOriginSchema,
  AUTH_COOKIE_SECRET: z
    .string()
    .min(32, "AUTH_COOKIE_SECRET must be at least 32 characters"),
  SMTP_HOST: z.string().trim().min(1, "SMTP_HOST is required"),
  SMTP_PORT: z.coerce
    .number()
    .int("SMTP_PORT must be an integer")
    .min(1, "SMTP_PORT must be between 1 and 65535")
    .max(65535, "SMTP_PORT must be between 1 and 65535"),
  SMTP_USER: z.string().trim().min(1, "SMTP_USER is required"),
  SMTP_PASSWORD: z.string().min(1, "SMTP_PASSWORD is required"),
  SMTP_FROM: z.email("SMTP_FROM must be a valid email address"),
});

export type AppEnv = Readonly<{
  trustProxy?: boolean;
  databaseUrl: string;
  appOrigin: string;
  authCookieSecret: string;
  smtp: Readonly<{
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  }>;
}>;

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const appOrigin = new URL(appOriginSchema.parse(input.APP_ORIGIN));

  if (input.NODE_ENV === "production" && appOrigin.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use https in production");
  }

  const env = rawEnvSchema.parse(input);

  return {
    trustProxy: env.TRUST_PROXY === "true",
    databaseUrl: env.DATABASE_URL,
    appOrigin: appOrigin.toString(),
    authCookieSecret: env.AUTH_COOKIE_SECRET,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
    },
  };
}
