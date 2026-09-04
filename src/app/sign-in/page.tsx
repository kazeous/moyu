import Link from "next/link";
import { AuthForm } from "@/client/auth/auth-form";

export default function SignInPage() {
  return (
    <main className="site-shell">
      <Link href="/">moyu</Link>
      <h1>Sign in</h1>
      <AuthForm mode="sign-in" />
      <p>
        <Link href="/magic-link">Email me a sign-in link</Link>
      </p>
      <p>
        New to moyu? <Link href="/sign-up">Create an account</Link>
      </p>
    </main>
  );
}
