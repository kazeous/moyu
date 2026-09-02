import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "@/server/env";

import { createSmtpMailer } from "./mailer";

const env: AppEnv = {
  databaseUrl: "postgresql://moyu:moyu@localhost:5432/moyu",
  appOrigin: "https://moyu.example.test/",
  authCookieSecret: "synthetic-test-secret-at-least-32-characters",
  smtp: {
    host: "smtp.example.test",
    port: 587,
    user: "synthetic-smtp-user",
    password: "synthetic-smtp-secret",
    from: "moyu@example.test",
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function captureMail(configuration = env) {
  const messages: string[] = [];
  const options: SMTPTransport.Options[] = [];
  const stream = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const mailer = createSmtpMailer(configuration, (transportOptions) => {
    options.push(transportOptions);
    return {
      async sendMail(message: Mail.Options) {
        const result = await stream.sendMail(message);
        messages.push(result.message.toString());
        return result;
      },
    };
  });
  return { mailer, messages, options };
}

describe("SMTP magic-link mailer", () => {
  it("renders a single sign-in email and returns no delivery details", async () => {
    const { mailer, messages } = captureMail();
    const url = "https://moyu.example.test/auth/verify#synthetic-token";
    await expect(
      mailer.sendMagicLink({ to: "ken@example.test", url }),
    ).resolves.toBeUndefined();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("From: moyu@example.test");
    expect(messages[0]).toContain("To: ken@example.test");
    expect(messages[0]).toContain("Subject: Sign in to moyu");
    // Nodemailer wraps quoted-printable body lines; email clients unfold them.
    expect(messages[0].replace(/=\r?\n/g, "")).toContain(url);
    expect(messages[0]).not.toContain(env.smtp.password);
  });

  it.each([587, 465])(
    "requires encrypted SMTP in production on port %s without protocol logs",
    async (port) => {
      vi.stubEnv("NODE_ENV", "production");
      const { mailer, options } = captureMail({
        ...env,
        smtp: { ...env.smtp, port },
      });
      await mailer.sendMagicLink({
        to: "ken@example.test",
        url: "https://moyu.example.test/auth/verify#token",
      });

      expect(options[0]).toMatchObject({
        host: "smtp.example.test",
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user: env.smtp.user, pass: env.smtp.password },
        tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
        logger: false,
        debug: false,
        transactionLog: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
  );

  it("allows a development SMTP capture server without STARTTLS", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { options } = captureMail({
      ...env,
      smtp: { ...env.smtp, host: "localhost", port: 1025 },
    });
    expect(options[0]).toMatchObject({ secure: false, requireTLS: false });
  });

  it.each([
    {
      to: "ken@example.test\r\nBcc: other@example.test",
      url: "https://moyu.example.test/auth/verify",
    },
    {
      to: "ken@example.test",
      url: "https://other.example.test/auth/verify#token",
    },
    {
      to: "ken@example.test",
      url: "http://moyu.example.test/auth/verify#token",
    },
    {
      to: "ken@example.test",
      url: "https://user:password@moyu.example.test/auth/verify#token",
    },
  ])(
    "rejects invalid recipients and unsafe link destinations without sending",
    async (input) => {
      const { mailer, messages } = captureMail();
      await expect(mailer.sendMagicLink(input)).rejects.toThrow(
        "Invalid magic-link email input",
      );
      expect(messages).toHaveLength(0);
    },
  );

  it("omits SMTP secrets and link material from failure errors and logs", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const mailer = createSmtpMailer(env, () => ({
      async sendMail() {
        throw new Error(
          `Provider failed with ${env.smtp.password} and synthetic-token`,
        );
      },
    }));

    await expect(
      mailer.sendMagicLink({
        to: "ken@example.test",
        url: "https://moyu.example.test/auth/verify#synthetic-token",
      }),
    ).rejects.toEqual(new Error("Magic link email could not be delivered"));
    expect(errorLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });
});
