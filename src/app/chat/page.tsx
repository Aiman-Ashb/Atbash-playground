"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  approval?: { command: string; description: string; allow_permanent: boolean; choice?: string };
};

export default function ChatPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "pending" | "active">("loading");
  const [label, setLabel] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Entry happens at "/". A code session is already active; a Telegram session
  // starts "pending" — we poll until an admin approves it (or it's gone).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function check() {
      try {
        const d = await (await fetch("/api/session")).json();
        if (cancelled) return;
        if (!d.session) return router.replace("/");
        setLabel(d.session.label);
        if (d.session.status === "active") {
          setMessages(d.session.messages ?? []);
          setPhase("active");
        } else {
          setPhase("pending");
          timer = setTimeout(check, 2500); // keep polling until approved
        }
      } catch {
        if (!cancelled) router.replace("/");
      }
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setError("");

    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content: text };
    const assistantMsg: Msg = { id: `a-${Date.now()}`, role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Agent unavailable.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const evName = evt.match(/^event: (.*)$/m)?.[1];
          const dataLine = evt.match(/^data: (.*)$/m)?.[1];
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (evName === "delta") {
            setMessages((m) =>
              m.map((x) => (x.id === assistantMsg.id ? { ...x, content: x.content + data.text } : x)),
            );
          } else if (evName === "approval_required") {
            setMessages((m) =>
              m.map((x) => (x.id === assistantMsg.id ? { ...x, approval: { ...data } } : x)),
            );
          } else if (evName === "error") {
            setError(data.error || "Agent error.");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent unavailable.");
    } finally {
      setMessages((m) => m.map((x) => (x.id === assistantMsg.id ? { ...x, streaming: false } : x)));
      setSending(false);
    }
  }

  async function submitApproval(messageId: string, choice: string) {
    try {
      setError("");
      const res = await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to submit approval.");
      }
      
      setMessages((m) =>
        m.map((x) => (x.id === messageId ? { ...x, approval: x.approval ? { ...x.approval, choice } : undefined } : x))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.");
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
  }

  if (phase === "loading") return <div className="center"><div className="sub">Loading…</div></div>;

  if (phase === "pending") {
    return (
      <div className="center">
        <div className="card" style={{ textAlign: "center" }}>
          <div className="spinner" />
          <h1 className="title" style={{ marginTop: 12 }}>Waiting for approval</h1>
          <p className="sub">
            Signed in as <strong>{label}</strong>. An organizer needs to approve you before you can chat — hang tight, this updates automatically.
          </p>
          <button
            className="btn ghost"
            onClick={logout}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="topbar">
        <span className="badge"><span className="dot" />{label || "Contestant"}</span>
        <div className="grow" />
        <button className="btn ghost" style={{ width: "auto", margin: 0, padding: "8px 14px" }} onClick={logout}>
          Log out
        </button>
      </div>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && <div className="empty">Say hello to the agent to begin.</div>}
        {messages.map((m) => (
          <div key={m.id} className={`row ${m.role}`}>
            <div>
              <div className="who">{m.role === "user" ? "You" : "Agent"}</div>
              <div className={`bubble ${m.role}`}>
                {m.content}
                {m.streaming && (
                  <span className="typing-indicator" style={{ marginLeft: 8, display: "inline-flex", verticalAlign: "middle" }}>
                    <span />
                    <span />
                    <span />
                  </span>
                )}
                {m.approval && (
                  <div className="approval-card">
                    <div className="approval-header">
                      <span className="approval-icon">⚠️</span>
                      <span className="approval-title">TOOL APPROVAL REQUIRED</span>
                    </div>
                    <div className="approval-desc">{m.approval.description}</div>
                    <pre className="approval-cmd"><code>{m.approval.command}</code></pre>
                    
                    {!m.approval.choice ? (
                      <div className="approval-actions">
                        <button className="btn mini" style={{ margin: "4px 8px 4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "once")}>
                          Approve Once
                        </button>
                        <button className="btn mini" style={{ margin: "4px 8px 4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "session")}>
                          Approve for Session
                        </button>
                        {m.approval.allow_permanent && (
                          <button className="btn mini" style={{ margin: "4px 8px 4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "always")}>
                            Always Approve
                          </button>
                        )}
                        <button className="btn mini danger" style={{ margin: "4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "deny")}>
                          Deny
                        </button>
                      </div>
                    ) : (
                      <div className={`approval-status ${m.approval.choice}`}>
                        {m.approval.choice === "deny" ? "❌ Request Denied" : "✅ Request Approved"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={send}>
        <input
          className="input"
          placeholder="Message the agent…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          autoFocus
        />
        <button className="btn" disabled={sending || !input.trim()}>Send</button>
      </form>
      {error && <div className="error" style={{ padding: "0 20px 12px" }}>{error}</div>}
    </div>
  );
}
