import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>moyu</h1>
      <p>Dialogue review with local evidence.</p>
      <p>
        <Link href="/sign-in">Sign in</Link> or{" "}
        <Link href="/sign-up">Create an account</Link>
      </p>
    </main>
  );
}
