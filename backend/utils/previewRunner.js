const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const running = new Map();
const BASE_PORT = Number(process.env.GENERATOR_PREVIEW_BASE_PORT || 6100);

function withProjectKey(url, projectName) {
  const raw = String(url || "").trim();
  const key = String(projectName || "").trim();
  if (!raw || !key) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}projectKey=${encodeURIComponent(key)}`;
}

function nextPort() {
  let p = BASE_PORT;
  const used = new Set(Array.from(running.values()).map((r) => r.port));
  while (used.has(p)) p += 1;
  return p;
}

function resolveEntry(projectDir) {
  const candidates = [
    "server.js",
    "src/server.js",
    "app.js",
    "index.js",
    path.join("backend", "server.js"),
    path.join("backend", "src", "server.js"),
    path.join("backend", "app.js"),
    path.join("backend", "index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(projectDir, c))) return c;
  }
  return null;
}

function findStaticHtmlEntry(projectDir) {
  const preferred = [
    path.join("frontend", "index.html"),
    path.join("frontend", "public", "index.html"),
    path.join("public", "index.html"),
    "index.html",
    "home.html",
    path.join("public", "home.html"),
  ];

  for (const rel of preferred) {
    if (fs.existsSync(path.join(projectDir, rel))) return rel.replace(/\\/g, "/");
  }

  const skipDirs = new Set(["node_modules", ".git", "dist", "build"]);
  const queue = [projectDir];
  let firstHtml = null;
  while (queue.length) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        queue.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        const rel = path.relative(projectDir, full).replace(/\\/g, "/");
        if (!firstHtml) firstHtml = rel;
      }
    }
  }
  return firstHtml;
}

function hasPackage(projectDir) {
  return fs.existsSync(path.join(projectDir, "package.json"));
}

function hasBackendPackage(projectDir) {
  return fs.existsSync(path.join(projectDir, "backend", "package.json"));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await ping(url);
    if (ok) return true;
    await wait(500);
  }
  return false;
}

function publicInfo(info) {
  return {
    mode: info.mode,
    pid: info.pid,
    port: info.port,
    url: info.url,
    startedAt: info.startedAt,
    running: info.mode === "server" ? !info.process?.killed : true,
  };
}

async function startPreview(projectName, projectDir) {
  const existing = running.get(projectName);
  if (existing) return publicInfo(existing);

  const staticEntry = findStaticHtmlEntry(projectDir);
  // Prefer real backend preview by default; static-only preview is opt-in via PREVIEW_PREFER_STATIC=true.
  const preferStatic = String(process.env.PREVIEW_PREFER_STATIC || "false").toLowerCase() === "true";

  const serverEntry = resolveEntry(projectDir);
  if (preferStatic && staticEntry && !serverEntry) {
    return {
      mode: "static",
      url: withProjectKey(`/generated_projects/${projectName}/${staticEntry}`, projectName),
      running: true,
    };
  }
  if (!serverEntry) {
    if (staticEntry) {
      return {
        mode: "static",
        url: withProjectKey(`/generated_projects/${projectName}/${staticEntry}`, projectName),
        running: true,
      };
    }
    throw new Error("No preview entry found");
  }

  const port = nextPort();
  const env = { ...process.env, PORT: String(port) };
  const serverDir = serverEntry.includes(path.join("backend", "")) ? path.join(projectDir, "backend") : projectDir;
  const backendHasPackage = serverDir === path.join(projectDir, "backend")
    ? hasBackendPackage(projectDir)
    : hasPackage(projectDir);

  const proc = backendHasPackage
    ? spawn("npm", ["start"], { cwd: serverDir, env, shell: true, stdio: "ignore" })
    : spawn("node", [path.basename(serverEntry)], { cwd: serverDir, env, shell: true, stdio: "ignore" });

  const info = {
    mode: "server",
    pid: proc.pid,
    port,
    url: withProjectKey(`http://localhost:${port}`, projectName),
    startedAt: Date.now(),
    projectDir,
    process: proc,
  };
  running.set(projectName, info);

  proc.on("exit", () => {
    if (running.get(projectName)?.pid === info.pid) {
      running.delete(projectName);
    }
  });

  const alive = await waitForServer(info.url);
  if (!alive) {
    try {
      proc.kill();
    } catch (_) {
      // ignore
    }
    running.delete(projectName);
    if (staticEntry) {
      return {
        mode: "static",
        url: withProjectKey(`/generated_projects/${projectName}/${staticEntry}`, projectName),
        running: true,
      };
    }
    throw new Error("Preview server failed to start");
  }

  return publicInfo(info);
}

function getPreviewStatus(projectName) {
  const info = running.get(projectName);
  if (!info) return null;
  return publicInfo(info);
}

function stopPreview(projectName) {
  const info = running.get(projectName);
  if (!info) return false;
  if (info.process && !info.process.killed) {
    info.process.kill();
  }
  running.delete(projectName);
  return true;
}

module.exports = {
  startPreview,
  getPreviewStatus,
  stopPreview,
};
