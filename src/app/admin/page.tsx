"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { id: string; role: "user" | "assistant"; content: string; at: number; streaming?: boolean };
type Summary = { id: string; label: string; code: string; source: "code" | "telegram"; status: "pending" | "active" | "ended"; messageCount: number; lastActivity: number };
type Code = { code: string; label: string; role: "contestant" | "admin"; createdAt: number; usedBySession?: string };

export default function AdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  const [sessions, setSessions] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  selectedRef.current = selected;

  async function refreshCodes() {
    const res = await fetch("/api/admin/codes");
    if (res.ok) setCodes((await res.json()).codes ?? []);
  }
  async function generateCode(role: "contestant" | "admin" = "contestant") {
    const res = await fetch("/api/admin/codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (res.ok) {
      const { code } = await res.json();
      await refreshCodes();
      copyCode(code.code);
    }
  }
  async function revokeCode(code: string) {
    await fetch("/api/admin/codes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    refreshCodes();
  }
  async function sessionAction(action: "end" | "approve" | "deny", id: string) {
    await fetch("/api/admin/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
  }
  function copyCode(code: string) {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
  }

  // Entry happens at "/". Confirm the admin cookie by probing a gated endpoint;
  // if it's not valid, bounce to the unified code page.
  useEffect(() => {
    fetch("/api/admin/sessions")
      .then((r) => {
        if (r.ok) {
          setAuthed(true);
          refreshCodes();
        } else router.replace("/");
      })
      .catch(() => router.replace("/"));
  }, [router]);

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

  // Unauthed users are redirected to "/" by the effect above; show a neutral
  // placeholder in the meantime (no hint that this is the admin view).
  if (!authed) return <div className="center"><div className="sub">Loading…</div></div>;

  return (
    <div className="admin">
      <div className="sidebar">
        <div className="codes-head">
          <h3>Access codes</h3>
          <div className="code-gen">
            <button className="mini" onClick={() => generateCode("contestant")}>+ Contestant</button>
            <button className="mini admin" onClick={() => generateCode("admin")}>+ Admin</button>
          </div>
        </div>
        {codes.length === 0 && <div className="sess meta">No codes generated. Click + Contestant for the next player, or + Admin to add another organizer.</div>}
        {codes.map((c) => (
          <div key={c.code} className="codeRow">
            <div>
              <span className="codeVal" onClick={() => copyCode(c.code)} title="Click to copy">{c.code}</span>
              {c.role === "admin" && <span className="tag" style={{ borderColor: "#e0a52a", color: "#e0a52a" }}>admin</span>}
              <span className="meta"> · {c.role === "admin" ? "organizer" : c.usedBySession ? "in use" : "unused"}</span>
            </div>
            <div className="codeActions">
              <button className="mini" onClick={() => copyCode(c.code)}>{copied === c.code ? "✓" : "copy"}</button>
              <button className="mini danger" onClick={() => revokeCode(c.code)}>revoke</button>
            </div>
          </div>
        ))}

        <h3>Sessions ({sessions.length})</h3>
        {sessions.length === 0 && <div className="sess meta">No sessions yet.</div>}
        {sessions.map((s) => (
          <div key={s.id} className={`sess ${selected === s.id ? "active" : ""}`} onClick={() => openSession(s.id)}>
            <div className="name">{s.label} {s.source === "telegram" && <span className="tag">Telegram</span>}</div>
            <div className="meta">
              {s.source === "telegram" ? "id" : "code"}: {s.code} · {s.messageCount} msgs ·{" "}
              {s.status === "pending" ? <span className="pending">● awaiting approval</span>
                : s.status === "active" ? <span className="live">● live</span>
                : <span className="ended">ended</span>}
            </div>
            {s.status === "pending" && (
              <div className="codeActions" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                <button className="mini" onClick={() => sessionAction("approve", s.id)}>Approve</button>
                <button className="mini danger" onClick={() => sessionAction("deny", s.id)}>Deny</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="shell">
        <div className="topbar">
          <span className="badge">Observer · read-only</span>
          <div className="grow" />
          {selected && sessions.find((s) => s.id === selected)?.status === "active" && (
            <button
              className="btn ghost"
              style={{ width: "auto", margin: 0, padding: "8px 14px" }}
              onClick={() => sessionAction("end", selected)}
            >
              End session
            </button>
          )}
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
