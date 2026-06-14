"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // One code box; the server decides the role (admin vs contestant) from which
  // set the code belongs to. The observer entrance is never advertised.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Invalid code.");
      router.push(d.role === "admin" ? "/admin" : "/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1 className="title">Atbash Playground</h1>
        <p className="sub">Enter your access code to begin.</p>
        <input
          className="input"
          placeholder="Access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete="off"
          disabled={busy}
        />
        <button className="btn" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Continue"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
