"use client";

import { useState } from "react";
import { submitAuth } from "./api";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await submitAuth("/api/auth/sign-out", {});
      window.location.replace("/sign-in");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to sign out. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={signOut}>
        {busy ? "Please wait…" : "Sign out"}
      </button>
    </>
  );
}
