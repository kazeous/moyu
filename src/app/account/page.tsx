import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/server/auth/sessions";
import { SESSION_COOKIE_NAME } from "@/server/http/response";
import { SignOutButton } from "@/client/auth/sign-out-button";

export default async function AccountPage() {
  const user = await getSessionUser(
    (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? "",
  );
  if (!user) redirect("/sign-in");
  return (
    <main className="site-shell">
      <Link href="/">moyu</Link>
      <h1>Your account</h1>
      <p>Signed in as {user.displayName}.</p>
      <p>{user.email}</p>
      <p>
        <Link href="/workspace">Open workspace</Link>
      </p>
      <SignOutButton />
    </main>
  );
}
