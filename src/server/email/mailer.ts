import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { z } from "zod";

import { parseEnv, type AppEnv } from "@/server/env";

const magicLinkEmailSchema = z
  .object({
    to: z.email().max(254),
    url: z.url().max(2048),
  })
  .strict();

export type Mailer = {
  sendMagicLink(input: { to: string; url: string }): Promise<void>;
};

type SmtpTransportFactory = (options: SMTPTransport.Options) => {
  sendMail(message: Mail.Options): Promise<unknown>;
};

export function createSmtpMailer(
  env: AppEnv = parseEnv(process.env),
  createTransport: SmtpTransportFactory = nodemailer.createTransport,
): Mailer {
  const secure = env.smtp.port === 465;
  const transport = createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure,
    requireTLS: process.env.NODE_ENV === "production" && !secure,
    auth: { user: env.smtp.user, pass: env.smtp.password },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
    transactionLog: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async sendMagicLink(input) {
      const parsed = magicLinkEmailSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid magic-link email input");
      const url = new URL(parsed.data.url);
      if (
        url.origin !== new URL(env.appOrigin).origin ||
        url.username ||
        url.password
      ) {
        throw new Error("Invalid magic-link email input");
      }

      try {
        await transport.sendMail({
          from: env.smtp.from,
          to: parsed.data.to,
          subject: "Sign in to moyu",
          text: `Open this link to sign in to moyu:\n\n${parsed.data.url}\n\nThis link expires in 15 minutes and can be used only once. If you did not request it, you can ignore this email.`,
        });
      } catch {
        // Provider errors may contain recipients, credentials, or message content.
        throw new Error("Magic link email could not be delivered");
      }
    },
  };
}
