import Link from "next/link";

export default function Home() {
  // Only the contestant entrance is advertised. Admins navigate to /admin
  // directly — no public link to the observer (don't signal the surface).
  return (
    <div className="center">
      <div className="card">
        <h1 className="title">Atbash Playground</h1>
        <p className="sub">Live agent playground for events.</p>
        <Link href="/chat" className="btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Enter as contestant
        </Link>
      </div>
    </div>
  );
}
