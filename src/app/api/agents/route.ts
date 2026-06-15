import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// execFile (not exec) — args are an array, never parsed as shell.
const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function GET() {
  try {
    // Resolve via PATH by default; override with OPENCLAW_PATH if needed.
    const openclawPath = process.env.OPENCLAW_PATH || "openclaw";
    const { stdout } = await execFileAsync(
      openclawPath,
      ["agents", "list", "--json"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    const agents = JSON.parse(stdout);
    return NextResponse.json({ agents });
  } catch (err) {
    console.error("Failed to load openclaw agents:", err);
    // Fallback if openclaw isn't found or errors
    return NextResponse.json({
      agents: [
        { id: "main", name: "main (default)", isDefault: true },
        { id: "tejo", name: "tejo", isDefault: false }
      ]
    });
  }
}
