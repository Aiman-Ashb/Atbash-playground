"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enter(e: React.FormEvent) {
    e.preventDefault();
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
      // The server decides the role — the client never picks it.
      router.push(d.role === "admin" ? "/admin" : "/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={enter}>
        <h1 className="title">Atbash Playground</h1>
        <p className="sub">Enter your code to begin.</p>
        <input
          className="input"
          placeholder="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete="off"
        />
        <button className="btn" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Continue"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
