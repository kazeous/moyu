import Link from "next/link";
import { AuthForm } from "@/client/auth/auth-form";

export default function MagicLinkPage() {
  return (
    <main>
      <Link href="/">moyu</Link>
      <h1>Sign in by email</h1>
      <p>Request a one-time link for your existing account.</p>
      <AuthForm mode="magic-link" />
      <p>
        <Link href="/sign-in">Use a password</Link>
      </p>
    </main>
  );
}
