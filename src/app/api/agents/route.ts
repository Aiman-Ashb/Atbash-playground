import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// execFile (not exec) — args are an array, never parsed as shell.
const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET() {
  const apiUrl = process.env.OPENCLAW_API_URL;
  if (apiUrl) {
    try {
      const headers: Record<string, string> = {
        "bypass-tunnel-reminder": "true"
      };
      if (process.env.OPENCLAW_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.OPENCLAW_API_KEY}`;
      }
      const response = await fetch(`${apiUrl}/agents`, { 
        headers,
        cache: "no-store"
      });
      if (response.ok) {
        const agents = await response.json();
        return NextResponse.json({ agents });
      }
      throw new Error(`Remote API returned status ${response.status}`);
    } catch (err) {
      console.error("Failed to load remote openclaw agents:", err);
      // Fallback
      return NextResponse.json({
        agents: [
          { id: "default", name: "default", isDefault: true }
        ]
      });
    }
  }

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
        { id: "default", name: "default", isDefault: true }
      ]
    });
  }
}
