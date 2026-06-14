import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, ADMIN_COOKIE } from "@/lib/auth";
import { generateCode, listCodes, revokeCode } from "@/lib/codes";

export const runtime = "nodejs";

async function requireAdmin(): Promise<boolean> {
  const jar = await cookies();
  return readToken(jar.get(ADMIN_COOKIE)?.value) === "admin";
}

/** GET — list admin-generated codes (with status). */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  return NextResponse.json({ codes: listCodes() });
}

/** POST { label? } — mint a fresh unique contestant code. */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  const { label } = (await req.json().catch(() => ({}))) as { label?: string };
  return NextResponse.json({ code: generateCode(label) });
}

/** DELETE { code } — revoke (cancel) a code. */
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) return NextResponse.json({ error: "code required." }, { status: 400 });
  return NextResponse.json({ ok: revokeCode(code) });
}
