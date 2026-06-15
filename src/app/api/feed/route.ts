import { NextResponse } from "next/server";
import { getAgentFeed, feedConfigured } from "@/lib/chromia";

export const runtime = "nodejs";

/** GET /api/feed — recent on-chain verdicts for the playground's agent (public,
 *  read-only Chromia query; no auth/key needed). */
export async function GET() {
  if (!feedConfigured()) {
    return NextResponse.json({ configured: false, items: [] });
  }
  const items = await getAgentFeed(15);
  return NextResponse.json({ configured: true, items });
}
