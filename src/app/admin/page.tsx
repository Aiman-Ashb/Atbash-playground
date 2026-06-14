"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { id: string; role: "user" | "assistant"; content: string; at: number; streaming?: boolean };
type Summary = { id: string; label: string; code: string; status: "active" | "ended"; messageCount: number; lastActivity: number };

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const selectedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  selectedRef.current = selected;

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Login failed.");
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  // Live event stream once authed.
  useEffect(() => {
    if (!authed) return;
    const es = new EventSource("/api/admin/stream");

    es.addEventListener("snapshot", (e) => setSessions(JSON.parse((e as MessageEvent).data).sessions));
    es.addEventListener("session", (e) => {
      const s = JSON.parse((e as MessageEvent).data).session as Summary;
      setSessions((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
    });
    es.addEventListener("message", (e) => {
      const { sessionId, message } = JSON.parse((e as MessageEvent).data);
      bumpSession(sessionId);
      if (selectedRef.current === sessionId) {
        setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
      }
    });
    es.addEventListener("message-delta", (e) => {
      const { sessionId, messageId, content } = JSON.parse((e as MessageEvent).data);
      if (selectedRef.current === sessionId) {
        setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, content: x.content + content } : x)));
      }
    });
    es.addEventListener("ended", (e) => {
      const { sessionId } = JSON.parse((e as MessageEvent).data);
      setSessions((prev) => prev.map((p) => (p.id === sessionId ? { ...p, status: "ended" } : p)));
    });

    return () => es.close();
  }, [authed]);

  function bumpSession(id: string) {
    setSessions((prev) => {
      const found = prev.find((p) => p.id === id);
      if (!found) return prev;
      return [{ ...found, lastActivity: Date.now() }, ...prev.filter((p) => p.id !== id)];
    });
  }

  async function openSession(id: string) {
    setSelected(id);
    const res = await fetch(`/api/admin/sessions?id=${id}`);
    if (res.ok) setMessages((await res.json()).session.messages ?? []);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (!authed) {
    return (
      <div className="center">
        <form className="card" onSubmit={login}>
          <h1 className="title">Admin observer</h1>
          <p className="sub">Read-only live view of contestant conversations.</p>
          <input
            className="input"
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button className="btn" disabled={busy || !password}>{busy ? "…" : "Sign in"}</button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="admin">
      <div className="sidebar">
        <h3>Sessions ({sessions.length})</h3>
        {sessions.length === 0 && <div className="sess meta">No sessions yet.</div>}
        {sessions.map((s) => (
          <div key={s.id} className={`sess ${selected === s.id ? "active" : ""}`} onClick={() => openSession(s.id)}>
            <div className="name">{s.label}</div>
            <div className="meta">
              code: {s.code} · {s.messageCount} msgs ·{" "}
              {s.status === "active" ? <span className="live">● live</span> : <span className="ended">ended</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="shell">
        <div className="topbar">
          <span className="badge">Observer · read-only</span>
        </div>
        <div className="messages" ref={scrollRef}>
          {!selected && <div className="empty">Select a session to watch it live.</div>}
          {selected && messages.length === 0 && <div className="empty">No messages yet.</div>}
          {messages.map((m) => (
            <div key={m.id} className={`row ${m.role}`}>
              <div>
                <div className="who">{m.role === "user" ? "Contestant" : "Agent"}</div>
                <div className={`bubble ${m.role}`}>
                  {m.content}
                  {m.streaming && <span style={{ opacity: 0.5 }}>▌</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
