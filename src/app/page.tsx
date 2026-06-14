import Link from "next/link";

export default function Home() {
  return (
    <div className="center">
      <div className="card">
        <h1 className="title">Atbash Playground</h1>
        <p className="sub">Live agent playground for events.</p>
        <Link href="/chat" className="btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Enter as contestant
        </Link>
        <Link href="/admin" className="btn ghost" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Admin observer
        </Link>
      </div>
    </div>
  );
}
