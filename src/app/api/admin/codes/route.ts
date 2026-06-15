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

/** POST { label?, role?, agentPubkey? } — mint a fresh unique code. A
 *  contestant code may bind an agent pubkey (the feed they'll see). */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  const { label, role, agentPubkey } = (await req.json().catch(() => ({}))) as {
    label?: string;
    role?: string;
    agentPubkey?: string;
  };
  const codeRole = role === "admin" ? "admin" : "contestant";
  if (agentPubkey) {
    const hex = agentPubkey.trim().replace(/^0x/, "");
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 2 || hex.length > 130) {
      return NextResponse.json({ error: "Agent pubkey must be even-length hex." }, { status: 400 });
    }
  }
  return NextResponse.json({ code: generateCode(label, codeRole, agentPubkey) });
}

/** DELETE { code } — revoke (cancel) a code. */
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 401 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) return NextResponse.json({ error: "code required." }, { status: 400 });
  return NextResponse.json({ ok: revokeCode(code) });
}
