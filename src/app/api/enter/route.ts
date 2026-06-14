import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { classifyCode, makeToken, SESSION_COOKIE, ADMIN_COOKIE } from "@/lib/auth";
import { createSession } from "@/lib/sessions";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * POST /api/enter — single entry point. One code box; the server decides the
 * role. Admin and contestant codes are indistinguishable to the client until a
 * valid one is entered, so the observer surface is never advertised.
 */
export async function POST(req: Request) {
  // One brute-force guard for the whole gate: 10 attempts / 5 min per IP.
  const rl = rateLimit(`enter:${clientIp(req)}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const role = code ? classifyCode(code) : null;
  if (!role) {
    return NextResponse.json({ error: "Invalid code." }, { status: 401 });
  }

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";

  if (role === "admin") {
    jar.set(ADMIN_COOKIE, makeToken("admin"), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return NextResponse.json({ role: "admin" });
  }

  // contestant — the code is the identity; one session per entry.
  const session = createSession(code!.trim());
  jar.set(SESSION_COOKIE, makeToken(session.id), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 4,
  });
  return NextResponse.json({ role: "contestant", label: session.label });
}
