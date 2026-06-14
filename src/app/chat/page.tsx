"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { id: string; role: "user" | "assistant"; content: string; streaming?: boolean };

export default function ChatPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [label, setLabel] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Entry happens at "/" now. If there's no active session, send them there.
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.session) {
          setLabel(d.session.label);
          setMessages(d.session.messages ?? []);
          setReady(true);
        } else {
          router.replace("/");
        }
      })
      .catch(() => router.replace("/"));
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

  async function endSession() {
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/");
  }

  if (!ready) return <div className="center"><div className="sub">Loading…</div></div>;

  return (
    <div className="shell">
      <div className="topbar">
        <span className="badge"><span className="dot" />{label || "Contestant"}</span>
        <div className="grow" />
        <button className="btn ghost" style={{ width: "auto", margin: 0, padding: "8px 14px" }} onClick={endSession}>
          End session
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
                {m.streaming && <span style={{ opacity: 0.5 }}>▌</span>}
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
