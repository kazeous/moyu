import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
const passwordSchema = z
  .string()
  .min(12)
  .max(1024)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 1024);
export const signInInputSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict();
export const signUpInputSchema = signInInputSchema
  .extend({ displayName: z.string().trim().min(1).max(80) })
  .strict();
export const magicLinkInputSchema = z.object({ email: emailSchema }).strict();
export const verifyMagicLinkInputSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const emptyInputSchema = z.object({}).strict();
