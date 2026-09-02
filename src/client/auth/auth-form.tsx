"use client";

import { useState, type FormEvent } from "react";
import { submitAuth } from "./api";

type Mode = "sign-up" | "sign-in" | "magic-link";
const labels: Record<Mode, string> = {
  "sign-up": "Create account",
  "sign-in": "Sign in",
  "magic-link": "Send sign-in link",
};

export function AuthForm({ mode }: { mode: Mode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: Record<string, string> = {
      email: String(form.get("email") ?? ""),
    };
    if (mode !== "magic-link")
      input.password = String(form.get("password") ?? "");
    if (mode === "sign-up")
      input.displayName = String(form.get("displayName") ?? "");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await submitAuth(`/api/auth/${mode}`, input);
      if (mode === "magic-link")
        setMessage(
          "If this email has an account, a sign-in link is on its way. Check your inbox.",
        );
      else window.location.assign("/account");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to continue. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      method="post"
      action={`/api/auth/${mode}`}
      onSubmit={submit}
      aria-busy={busy}
    >
      {mode === "sign-up" && (
        <label>
          Display name
          <input
            name="displayName"
            autoComplete="nickname"
            required
            maxLength={80}
          />
        </label>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {mode !== "magic-link" && (
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "sign-up" ? "new-password" : "current-password"
            }
            required
            minLength={12}
            maxLength={1024}
            aria-describedby={mode === "sign-up" ? "password-help" : undefined}
          />
        </label>
      )}
      {mode === "sign-up" && (
        <p id="password-help">Use at least 12 characters.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Please wait…" : labels[mode]}
      </button>
    </form>
  );
}
