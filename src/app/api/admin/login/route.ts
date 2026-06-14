import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidAdminPassword, makeToken, ADMIN_COOKIE } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** POST /api/admin/login — { password }. Sets the admin cookie on success. */
export async function POST(req: Request) {
  // Brute-force guard: 5 attempts / 5 min per IP.
  const rl = rateLimit(`admin-login:${clientIp(req)}`, 5, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !isValidAdminPassword(password)) {
    return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
  }
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, makeToken("admin"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
  return NextResponse.json({ ok: true });
}
