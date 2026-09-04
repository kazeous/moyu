import Link from "next/link";

export default function HomePage() {
  return (
    <main className="site-shell">
      <p className="site-shell__eyebrow">Private language review</p>
      <h1>moyu</h1>
      <p>
        Review Japanese and Chinese dialogue with English or Vietnamese
        references. Dialogue stays in this browser.
      </p>
      <div className="site-shell__actions">
        <Link className="site-shell__primary-link" href="/workspace">
          Open workspace
        </Link>
        <Link href="/sign-in">Sign in</Link>
        <Link href="/sign-up">Create an account</Link>
      </div>
    </main>
  );
}
