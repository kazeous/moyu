import Link from "next/link";
import { ConfirmForm } from "@/client/auth/confirm-form";

export default function ConfirmPage() {
  return (
    <main className="site-shell">
      <Link href="/">moyu</Link>
      <h1>Confirm sign in</h1>
      <ConfirmForm />
      <p>
        <Link href="/magic-link">Request a new link</Link>
      </p>
    </main>
  );
}
