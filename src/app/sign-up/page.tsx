import Link from "next/link";
import { AuthForm } from "@/client/auth/auth-form";

export default function SignUpPage() {
  return (
    <main className="site-shell">
      <Link href="/">moyu</Link>
      <h1>Create your account</h1>
      <p>Save your personal terminology and settings.</p>
      <AuthForm mode="sign-up" />
      <p>
        Already registered? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
