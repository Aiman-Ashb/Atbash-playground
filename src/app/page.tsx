"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Public config (inlined at build): set BOT_USERNAME for the real widget, or
// LOGIN_MODE="mock" to show a dev button that simulates a Telegram login.
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";
const LOGIN_MODE = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN || "";
const TELEGRAM_ON = Boolean(BOT_USERNAME) || LOGIN_MODE === "mock";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tgRef = useRef<HTMLDivElement>(null);

  // Shared: post a payload to the unified gate and route by the server's role.
  async function submit(payload: { code: string } | { telegram: Record<string, unknown> }) {
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

  // Mount the real Telegram Login Widget when a bot username is configured.
  useEffect(() => {
    window.onTelegramAuth = (user) => submit({ telegram: user });
    if (!BOT_USERNAME || LOGIN_MODE === "mock" || !tgRef.current) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", BOT_USERNAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    tgRef.current.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dev/no-bot: simulate a verified Telegram login (server is in TELEGRAM_MOCK).
  function mockTelegram() {
    submit({
      telegram: {
        id: Math.floor(100000 + Math.random() * 900000),
        first_name: "Demo",
        username: "demo_tg",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "mock",
      },
    });
  }

  return (
    <div className="center">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) submit({ code });
        }}
      >
        <h1 className="title">Atbash Playground</h1>
        <p className="sub">Enter your code to begin.</p>
        <input
          className="input"
          placeholder="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete="off"
          disabled={busy}
        />
        <button className="btn" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Continue"}
        </button>

        {TELEGRAM_ON && (
          <>
            <div className="divider"><span>or</span></div>
            {LOGIN_MODE === "mock" ? (
              <button type="button" className="btn tg" onClick={mockTelegram} disabled={busy}>
                Continue with Telegram (dev)
              </button>
            ) : (
              <div ref={tgRef} style={{ display: "flex", justifyContent: "center" }} />
            )}
          </>
        )}

        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
