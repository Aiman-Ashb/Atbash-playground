"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [tg, setTg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Post to the unified gate and route by the server's decision. Telegram-handle
  // logins return status "pending" → the /chat page shows a waiting screen until
  // an admin approves them.
  async function submit(payload: { code: string } | { telegramHandle: string }) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not sign in.");
      router.push(d.role === "admin" ? "/admin" : "/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card">
        <h1 className="title">Atbash Playground</h1>
        <p className="sub">Enter your access code, or sign in with your Telegram handle.</p>

        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) submit({ code }); }}>
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
        </form>

        <div className="divider"><span>or Telegram</span></div>

        <form onSubmit={(e) => { e.preventDefault(); if (tg.trim()) submit({ telegramHandle: tg }); }}>
          <input
            className="input"
            placeholder="Telegram username or ID (e.g. @alice)"
            value={tg}
            onChange={(e) => setTg(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <button type="submit" className="btn tg" disabled={busy || !tg.trim()}>
            {busy ? "…" : "Continue with Telegram"}
          </button>
        </form>
        <p className="hint">Telegram sign-ins wait for an organizer to approve you.</p>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
