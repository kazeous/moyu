"use client";

import { useEffect, useState } from "react";
import { submitAuth } from "./api";

export function ConfirmForm() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      setToken(/^[A-Za-z0-9_-]{43}$/.test(fragment) ? fragment : "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await submitAuth("/api/auth/magic-link/verify", { token });
      window.location.replace("/account");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to continue. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        Confirm to sign in on this browser. Links expire after 15 minutes and
        work once.
      </p>
      {!token && <p>Open the complete link from your email to continue.</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={!token || busy} onClick={confirm}>
        {busy ? "Please wait…" : "Confirm sign in"}
      </button>
    </>
  );
}
