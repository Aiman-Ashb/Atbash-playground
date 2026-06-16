"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [tg, setTg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<Array<{ id: string; name?: string; isDefault?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState("main");

  // Fetch configured OpenClaw agents on mount
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        if (d.agents && d.agents.length > 0) {
          setAgents(d.agents);
          const defaultAgent = d.agents.find((a: any) => a.isDefault)?.id || d.agents[0].id;
          setSelectedAgent(defaultAgent);
        }
      })
      .catch((err) => console.error("Error loading agents:", err));
  }, []);

  // Redirect to chat page if session is already active
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.session) {
          router.replace("/chat");
        }
      })
      .catch((err) => console.error("Error checking session:", err));
  }, [router]);

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
        body: JSON.stringify({ ...payload, agentId: selectedAgent }),
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

        {agents.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11px", color: "var(--dim)", display: "block", marginBottom: "6px", textTransform: "uppercase", fontWeight: 600 }}>Target Agent</label>
            <select
              className="input"
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              disabled={busy}
              style={{ cursor: "pointer", width: "100%" }}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} style={{ background: "var(--panel)" }}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </div>
        )}

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
