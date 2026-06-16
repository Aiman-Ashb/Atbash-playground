/**
 * Hermes / OpenClaw API Bridge (Express Server)
 * 
 * Exposes local Hermes profiles to the deployed website and supports interactive tool approvals.
 */

const express = require("express");
const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const execAsync = promisify(exec);

const app = express();
app.use(express.json());

const os = require("os");

const PORT = process.env.PORT || 4000;
const HERMES_PATH = process.env.HERMES_PATH || path.join(os.homedir(), ".local", "bin", "hermes");
const API_KEY = process.env.OPENCLAW_API_KEY || "change-me-in-production";

// Map to track active sessions for interactive control
const activeSessions = new Map();

// Session mapping database to map client sessionIds to real Hermes sessionIds
const mapPath = path.join(__dirname, "session-map.json");
let sessionMap = {};
if (fs.existsSync(mapPath)) {
  try {
    sessionMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch (e) {
    console.error("Failed to read session map:", e);
  }
}

// Authentication Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!API_KEY) return next();
  if (authHeader === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

function getHermesProfiles() {
  const profilesDir = path.join(os.homedir(), ".hermes", "profiles");
  let dirs = [];
  try {
    if (fs.existsSync(profilesDir)) {
      dirs = fs.readdirSync(profilesDir).filter(file => {
        return fs.statSync(path.join(profilesDir, file)).isDirectory();
      });
    }
  } catch (err) {
    console.error("Failed to read hermes profiles directory:", err);
  }

  const customDirs = dirs.filter(d => d !== "default");
  const profiles = [];

  if (customDirs.length > 0) {
    // If there are custom profiles, only list them
    customDirs.forEach((dir, index) => {
      profiles.push({
        id: dir,
        name: dir,
        isDefault: dir === "tejo3" || (index === 0 && !customDirs.includes("tejo3"))
      });
    });
  } else {
    // Fall back to showing 'default' only if no custom profiles exist
    profiles.push({
      id: "default",
      name: "default",
      isDefault: true
    });
  }
  return profiles;
}

// 1. GET /agents - List configured Hermes profiles
app.get("/agents", authenticate, async (req, res) => {
  try {
    const profiles = getHermesProfiles();
    res.json(profiles);
  } catch (err) {
    console.error("Failed to list profiles:", err);
    res.json([
      { id: "default", name: "default", isDefault: true },
      { id: "tejo3", name: "tejo3", isDefault: false }
    ]);
  }
});

// 2. POST /agent - Execute a Hermes turn in interactive query mode (streams stdout in real-time)
app.post("/agent", authenticate, async (req, res) => {
  const { agentId, sessionId, message } = req.body;
  if (!agentId || !sessionId || !message) {
    return res.status(400).json({ error: "agentId, sessionId, and message are required" });
  }

  let targetAgent = agentId;
  const profiles = getHermesProfiles();
  if (!profiles.some(p => p.id === targetAgent)) {
    const defaultProfile = profiles.find(p => p.isDefault) || { id: "default" };
    console.log(`[Hermes Bridge] Profile '${targetAgent}' not found. Falling back to '${defaultProfile.id}'`);
    targetAgent = defaultProfile.id;
  }

  // Set headers for streaming response
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const isMock = HERMES_PATH.endsWith("mock-hermes.sh");
  const mappedSessionId = isMock ? sessionId : sessionMap[sessionId];

  if (mappedSessionId) {
    console.log(`[Hermes Bridge] Spawning: "${HERMES_PATH}" -p "${targetAgent}" --resume "${mappedSessionId}" --quiet -q "${message}"`);
  } else {
    console.log(`[Hermes Bridge] Spawning new session: "${HERMES_PATH}" -p "${targetAgent}" --quiet -q "${message}"`);
  }

  // Kill existing session process if it exists to avoid conflicts
  if (activeSessions.has(sessionId)) {
    console.log(`[Hermes Bridge] Terminating stale process for session ${sessionId}`);
    try {
      activeSessions.get(sessionId).child.kill();
    } catch (e) {
      console.error(e);
    }
    activeSessions.delete(sessionId);
  }

  // Determine spawn arguments. If we're using mock-hermes.sh, pass it directly.
  let spawnCmd = HERMES_PATH;
  let spawnArgs = [
    "-p", targetAgent,
    "chat",
    "-q", message
  ];
  if (mappedSessionId) {
    spawnArgs.splice(2, 0, "--resume", mappedSessionId);
  }

  if (isMock) {
    spawnCmd = "/bin/bash";
    spawnArgs = [HERMES_PATH, "-q", message];
  }

  const child = spawn(spawnCmd, spawnArgs, {
    env: {
      ...process.env,
      HERMES_INTERACTIVE: "1",
      PYTHONUNBUFFERED: "1"
    }
  });

  let stdoutBuffer = "";
  let isBufferingApproval = false;
  let approvalBuffer = [];
  let discardConfirmation = false;

  function cleanLineAnsi(line) {
    return line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "").trim();
  }

  function isChoiceOrOptionLine(line) {
    const clean = cleanLineAnsi(line).toLowerCase();
    return (
      clean.includes("[o]nce") ||
      clean.includes("[s]ession") ||
      clean.includes("[a]lways") ||
      clean.includes("[d]eny") ||
      clean.includes("choice [") ||
      clean.includes("choice (") ||
      clean.includes("allowed once") ||
      clean.includes("allowed session") ||
      clean.includes("allowed always") ||
      clean.includes("denied")
    );
  }

  function processLine(line) {
    const cleanLine = cleanLineAnsi(line);
    
    // 1. If we are discarding the confirmation result message after user input (e.g. "✓ Allowed once")
    if (discardConfirmation) {
      if (
        cleanLine.includes("Allowed once") ||
        cleanLine.includes("Denied") ||
        cleanLine.includes("Allowed always") ||
        cleanLine.includes("Allowed session") ||
        cleanLine.includes("Allowed for session") ||
        cleanLine.includes("Allowed for Session")
      ) {
        discardConfirmation = false;
      }
      return;
    }

    // 2. Handle dangerous command buffering
    if (isBufferingApproval) {
      approvalBuffer.push(cleanLine);
      if (cleanLine.includes("Choice [") || cleanLine.includes("Choice (")) {
        let description = "Dangerous command approval required";
        let command = "";
        
        // Try parsing Format 1: Mock (DANGEROUS COMMAND: <desc>)
        const mockDescIndex = approvalBuffer.findIndex(l => l.includes("DANGEROUS COMMAND:"));
        if (mockDescIndex !== -1) {
          const descLine = approvalBuffer[mockDescIndex];
          description = descLine.split("DANGEROUS COMMAND:")[1].trim();
          
          // Filter out choice description, choices, and empty lines
          const cmdLines = approvalBuffer.slice(mockDescIndex + 1)
            .map(l => l.trim())
            .filter(l => l.length > 0 && !isChoiceOrOptionLine(l));
          command = cmdLines.join("\n").trim();
        } else {
          // Try parsing Format 2: Real Agent (TOOL APPROVAL REQUIRED)
          const realHeaderIndex = approvalBuffer.findIndex(l => l.includes("TOOL APPROVAL REQUIRED"));
          if (realHeaderIndex !== -1) {
            const remainingLines = approvalBuffer.slice(realHeaderIndex + 1)
              .map(l => l.trim())
              .filter(l => l.length > 0 && !isChoiceOrOptionLine(l));
            
            if (remainingLines.length >= 2) {
              description = remainingLines[0];
              command = remainingLines.slice(1).join("\n").trim();
            } else if (remainingLines.length === 1) {
              command = remainingLines[0];
            }
          }
        }

        const payload = {
          status: "approval_required",
          command: command,
          description: description,
          allow_permanent: approvalBuffer.some(l => l.includes("[a]lways") || l.includes("(a)lways"))
        };

        res.write(`\n[__HERMES_APPROVAL_REQUIRED__:${JSON.stringify(payload)}]\n`);
        isBufferingApproval = false;
        approvalBuffer = [];
      }
      return;
    }

    // 3. Detect start of dangerous command
    if (cleanLine.includes("DANGEROUS COMMAND:") || cleanLine.includes("TOOL APPROVAL REQUIRED")) {
      isBufferingApproval = true;
      approvalBuffer.push(cleanLine);
      return;
    }

    // 4. Check for tool progress calls
    const toolMatch = cleanLine.match(/(?:Running tool|Executing tool|Preparing tool|Tool call:|Calling tool)\s+([a-zA-Z0-9_-]+)/i);
    if (toolMatch) {
      const toolName = toolMatch[1];
      res.write(`\n[__HERMES_PROGRESS__:${JSON.stringify({ status: "running_tool", tool: toolName })}]\n`);
      return; // swallow progress line
    }

    // Swallow other system logs
    if (
      cleanLine === "⚠️" ||
      cleanLine === "⚠️ " ||
      cleanLine.startsWith("[System]") ||
      cleanLine.startsWith("[Info]") ||
      cleanLine.startsWith("[TUI]") ||
      cleanLine.startsWith("⚕") ||
      cleanLine.startsWith("→") ||
      cleanLine.startsWith("✓") ||
      cleanLine.startsWith("●") ||
      cleanLine.toLowerCase().includes("initializing agent") ||
      cleanLine.includes("───────────────────") ||
      cleanLine.startsWith("Query:") ||
      cleanLine.startsWith("Resume this session with:") ||
      cleanLine.includes("hermes --resume") ||
      cleanLine.startsWith("Session:") ||
      cleanLine.startsWith("Duration:") ||
      cleanLine.startsWith("Messages:") ||
      cleanLine.includes("┊") ||
      cleanLine.includes("⏱") ||
      cleanLine.includes("BLOCKED:")
    ) {
      return;
    }

    // Default: write direct line to stream
    res.write(line + "\n");
  }

  const sessionObj = {
    child,
    res,
    sendDecision: (choice) => {
      discardConfirmation = true;
      child.stdin.write(choice + "\n");
    }
  };
  activeSessions.set(sessionId, sessionObj);

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      processLine(line);
    }
    
    // Check if the remaining buffer (which has no trailing newline) contains the choice prompt
    if (isBufferingApproval && (stdoutBuffer.includes("Choice [") || stdoutBuffer.includes("Choice ("))) {
      processLine(stdoutBuffer);
      stdoutBuffer = "";
    }
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    console.error(`[Hermes CLI Error] ${text}`);

    // Parse and map the generated session ID from stderr
    if (!isMock && !sessionMap[sessionId]) {
      const match = text.match(/session_id:\s*(\S+)/);
      if (match) {
        const newHermesId = match[1];
        console.log(`[Hermes Bridge] Mapped session ${sessionId} -> ${newHermesId}`);
        sessionMap[sessionId] = newHermesId;
        try {
          fs.writeFileSync(mapPath, JSON.stringify(sessionMap, null, 2), "utf8");
        } catch (e) {
          console.error("Failed to write session map:", e);
        }
      }
    }
  });

  child.on("error", (err) => {
    console.error("[Hermes Bridge] Failed to start process:", err);
    activeSessions.delete(sessionId);
    if (!res.headersSent) {
      res.status(500).end(`[error: Failed to start agent process: ${err.message}]`);
    }
  });

  child.on("close", (code) => {
    console.log(`[Hermes Bridge] Process exited with code ${code}`);
    if (stdoutBuffer) {
      processLine(stdoutBuffer);
    }
    activeSessions.delete(sessionId);
    res.end();
  });
});

// 3. POST /agent/approve - Submit a decision for a pending tool approval
app.post("/agent/approve", authenticate, (req, res) => {
  const { sessionId, choice } = req.body;
  if (!sessionId || !choice) {
    return res.status(400).json({ error: "sessionId and choice are required" });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: `No active agent session found for ID ${sessionId}` });
  }

  console.log(`[Hermes Bridge] Forwarding approval decision '${choice}' for session ${sessionId}`);
  session.sendDecision(choice);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Hermes API Bridge listening on port ${PORT}`);
});
