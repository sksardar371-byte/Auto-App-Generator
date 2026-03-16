const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeProductName(projectName) {
  const raw = String(projectName || "Generated App");
  const cleaned = raw
    .replace(/[-_]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Generated App";
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sanitizeDependencyMap(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const nameRe = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
  for (const [name, version] of Object.entries(input)) {
    if (!nameRe.test(String(name || "").trim())) continue;
    const v = String(version || "").trim();
    if (!v) continue;
    out[String(name).trim()] = v;
  }
  return out;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getFreeBytesForPath(targetPath) {
  try {
    if (typeof fs.statfsSync !== "function") return null;
    const stats = fs.statfsSync(targetPath);
    const bavail = Number(stats?.bavail);
    const bsize = Number(stats?.bsize);
    if (!Number.isFinite(bavail) || !Number.isFinite(bsize)) return null;
    return Math.max(0, bavail * bsize);
  } catch (_err) {
    return null;
  }
}

function ensureSufficientDiskSpace(targetPath, minBytes) {
  const required = Number(minBytes || 0);
  if (!Number.isFinite(required) || required <= 0) return;
  const freeBytes = getFreeBytesForPath(targetPath);
  if (freeBytes == null) return;
  if (freeBytes < required) {
    throw new Error(
      `Insufficient disk space for EXE build. Free: ${formatBytes(freeBytes)}, required: ${formatBytes(required)}. Clear disk space and retry.`
    );
  }
}

function normalizeExecutableBuildError(err) {
  const message = String(err?.message || "Executable build failed");
  const stderr = String(err?.stderr || "");
  const stdout = String(err?.stdout || "");
  const combined = `${message}\n${stderr}\n${stdout}`.toLowerCase();

  if (combined.includes("enospc") || combined.includes("no space left on device")) {
    return new Error("Executable build failed: no disk space left. Clear drive space and retry.");
  }
  if (combined.includes("etimedout") || combined.includes("timed out")) {
    return new Error("Executable build timed out. Increase AI_EXE_BUILD_TIMEOUT_MS or retry when system is less busy.");
  }
  if (combined.includes("ebusy") || combined.includes("eperm") || combined.includes("resource busy or locked")) {
    return new Error("Executable build failed due to locked files (EBUSY/EPERM). Close running preview/app processes and retry.");
  }

  const tailSource = (stderr || stdout || message).trim().split("\n").slice(-25).join("\n");
  return new Error(`Executable build failed. Details:\n${tailSource}`);
}

function isRetryableBuildError(err) {
  const message = String(err?.message || "").toLowerCase();
  const stderr = String(err?.stderr || "").toLowerCase();
  const stdout = String(err?.stdout || "").toLowerCase();
  const text = `${message}\n${stderr}\n${stdout}`;
  return (
    text.includes("ebusy") ||
    text.includes("eperm") ||
    text.includes("resource busy or locked") ||
    text.includes("etimedout") ||
    text.includes("timed out")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function safeRm(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
  } catch (_err) {
    return false;
  }
}

async function runCommandWithRetries(command, args, options = {}, variants = []) {
  const attempts = [args, ...variants].filter((x) => Array.isArray(x) && x.length > 0);
  let lastErr = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const currentArgs = attempts[i];
    try {
      return await runCommand(command, currentArgs, options);
    } catch (err) {
      lastErr = err;
      const retryable = i < attempts.length - 1;
      if (!retryable) break;
      if (typeof options?.onLog === "function") {
        options.onLog(`Command retry ${i + 1}/${attempts.length - 1}: ${command} ${currentArgs.join(" ")}\n`);
      }
      await sleep(1200);
    }
  }
  throw lastErr || new Error(`Command failed: ${command} ${String(args || []).join(" ")}`);
}

function cleanupGeneratedArtifacts(projectDir, onProgress) {
  const enabled = String(process.env.AI_EXE_AUTO_CLEANUP || "true").toLowerCase() !== "false";
  if (!enabled) return;

  const projectRoot = path.dirname(projectDir);
  const keepProjects = Math.max(1, Number(process.env.AI_EXE_KEEP_PROJECTS || 8));
  const heavyPathsInProject = ["dist", "out", ".cache"];

  // Always clear heavy transient folders in current project before build.
  for (const rel of heavyPathsInProject) {
    safeRm(path.join(projectDir, rel));
  }

  let dirs = [];
  try {
    dirs = fs.readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(projectRoot, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = Number(fs.statSync(full).mtimeMs || 0);
        } catch (_err) {
          mtimeMs = 0;
        }
        return { name: entry.name, full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (_err) {
    return;
  }

  const currentName = path.basename(projectDir);
  let removedCount = 0;
  for (let i = 0; i < dirs.length; i += 1) {
    const item = dirs[i];
    if (!item || item.name === currentName) continue;
    const isBeyondKeep = i >= keepProjects;

    if (isBeyondKeep) {
      if (safeRm(item.full)) removedCount += 1;
      continue;
    }

    // Keep recent projects, but strip heavyweight folders to reduce disk pressure.
    const heavyChildren = [
      path.join(item.full, "node_modules"),
      path.join(item.full, "backend", "node_modules"),
      path.join(item.full, "dist"),
      path.join(item.full, "out"),
      path.join(item.full, ".cache"),
    ];
    for (const hp of heavyChildren) {
      safeRm(hp);
    }
  }

  if (typeof onProgress === "function" && removedCount > 0) {
    onProgress(`Auto-cleanup removed ${removedCount} old generated project folder(s) before EXE build.`);
  }
}

function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 15 * 60 * 1000,
    onLog,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      shell: true,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_err) {
        // Ignore kill errors.
      }
    }, Math.max(1000, Number(timeoutMs) || 0));

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      if (typeof onLog === "function" && text.trim()) onLog(text);
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      if (typeof onLog === "function" && text.trim()) onLog(text);
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(`Command timed out: ${command} ${args.join(" ")}`);
        error.code = "ETIMEDOUT";
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      if (code !== 0) {
        const tail = (stderr || stdout).trim().split("\n").slice(-20).join("\n");
        const error = new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${tail}`);
        error.code = String(code);
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}

function ensureElectronScaffold(projectDir, projectName, backendDependencies = {}) {
  const packageJsonPath = path.join(projectDir, "package.json");
  const existingPkg = readJsonSafe(packageJsonPath) || {};
  const productName = sanitizeProductName(projectName);
  const rootDependencies = {
    ...sanitizeDependencyMap(existingPkg.dependencies),
    ...sanitizeDependencyMap(backendDependencies),
  };

  const pkg = {
    name: (
      String(existingPkg.name || String(projectName || "generated-app"))
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "generated-app"
    ),
    version: String(existingPkg.version || "1.0.0"),
    private: true,
    main: "electron-main.js",
    scripts: {
      dist: "electron-builder --win portable --publish=never",
    },
    build: {
      appId: existingPkg.build?.appId || `com.generated.${String(projectName || "app").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
      productName,
      asar: false,
      files: [
        "electron-main.js",
        "frontend/**/*",
        "backend/**/*",
        "!backend/node_modules/**",
        "package.json",
      ],
      win: {
        target: ["portable"],
      },
      artifactName: "${productName}-${version}.${ext}",
    },
    devDependencies: {
      electron: "^30.0.0",
      "electron-builder": "^24.13.3",
    },
    dependencies: rootDependencies,
  };

  writeJson(packageJsonPath, pkg);
  safeRm(path.join(projectDir, "package-lock.json"));

  const electronMainPath = path.join(projectDir, "electron-main.js");
  fs.writeFileSync(
    electronMainPath,
    `const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const PORT = Number(process.env.APP_PORT || 5000);

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(ping, 400);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(ping, 400);
      });
    };
    ping();
  });
}

function startBackendServer() {
  const backendDir = path.join(__dirname, "backend");
  const serverFile = path.join(backendDir, "server.js");
  if (!fs.existsSync(serverFile)) return false;
  try {
    process.env.PORT = String(PORT);
    require(serverFile);
    return true;
  } catch (_err) {
    return false;
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const started = startBackendServer();
  const serverReady = started
    ? await waitForServer(\`http://127.0.0.1:\${PORT}\`, 12000)
    : false;

  const frontendCandidates = [
    path.join(__dirname, "frontend", "index.html"),
    path.join(__dirname, "frontend", "public", "index.html"),
    path.join(__dirname, "public", "index.html"),
    path.join(__dirname, "index.html"),
  ];
  for (const candidate of frontendCandidates) {
    if (fs.existsSync(candidate)) {
      await win.loadFile(candidate);
      return;
    }
  }

  if (serverReady) {
    await win.loadURL(\`http://127.0.0.1:\${PORT}\`);
    return;
  }
  await win.loadURL("data:text/plain,Application build completed but no runnable entry file found.");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
`,
    "utf8"
  );

  ensureDir(path.join(projectDir, "dist"));
}

function ensureBackendPackageJson(backendDir, onProgress) {
  const pkgPath = path.join(backendDir, "package.json");
  const parsed = readJsonSafe(pkgPath);

  const fallback = {
    name: "generated-backend",
    version: "1.0.0",
    private: true,
    main: "server.js",
    scripts: {
      start: "node server.js",
    },
    dependencies: {
      express: "^4.19.2",
      cors: "^2.8.5",
      dotenv: "^16.4.5",
      jsonwebtoken: "^9.0.2",
      bcryptjs: "^2.4.3",
      mysql2: "^3.11.3",
      mongoose: "^8.7.0",
    },
  };

  let next = null;
  if (!parsed) {
    next = fallback;
    if (typeof onProgress === "function") {
      onProgress("backend/package.json missing or invalid; using safe fallback package manifest.");
    }
  } else {
    next = {
      name: String(parsed.name || "generated-backend"),
      version: String(parsed.version || "1.0.0"),
      private: true,
      main: String(parsed.main || "server.js"),
      scripts: {
        start: String(parsed?.scripts?.start || "node server.js"),
      },
      dependencies: {
        ...fallback.dependencies,
        ...sanitizeDependencyMap(parsed.dependencies),
      },
    };
  }

  writeJson(pkgPath, next);
  safeRm(path.join(backendDir, "package-lock.json"));
  return next;
}

function findFirstExe(distDir) {
  if (!fs.existsSync(distDir)) return null;
  const queue = [distDir];
  while (queue.length) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "win-unpacked") continue;
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
        return fullPath;
      }
    }
  }
  return null;
}

async function buildElectronExecutable(options) {
  const {
    projectDir,
    projectName,
    timeoutMs = 25 * 60 * 1000,
    onProgress,
    onLog,
  } = options || {};

  if (!projectDir || !projectName) throw new Error("projectDir and projectName are required");

  const backendDir = path.join(projectDir, "backend");
  if (!fs.existsSync(backendDir)) throw new Error("Generated project missing backend directory");
  if (!fs.existsSync(path.join(projectDir, "frontend"))) throw new Error("Generated project missing frontend directory");

  try {
    cleanupGeneratedArtifacts(projectDir, onProgress);
    const backendPkg = ensureBackendPackageJson(backendDir, onProgress);
    ensureElectronScaffold(projectDir, projectName, backendPkg?.dependencies || {});

    const minFreeBytes = Number(process.env.AI_EXE_MIN_FREE_BYTES || (1.2 * 1024 * 1024 * 1024));
    ensureSufficientDiskSpace(projectDir, minFreeBytes);

    const forceInstall = String(process.env.AI_EXE_FORCE_INSTALL || "false").toLowerCase() === "true";
    const installBackendDeps = String(process.env.AI_EXE_INSTALL_BACKEND_DEPS || "false").toLowerCase() === "true";
    const backendNodeModules = path.join(backendDir, "node_modules");
    const rootNodeModules = path.join(projectDir, "node_modules");
    const electronBuilderCmd = path.join(rootNodeModules, ".bin", "electron-builder.cmd");
    const electronBuilderBin = path.join(rootNodeModules, ".bin", "electron-builder");

    // Prefer a single root node_modules for Electron packaging; this avoids repeated ENOSPC/EBUSY issues.
    safeRm(backendNodeModules);

    if (installBackendDeps && (forceInstall || !fs.existsSync(backendNodeModules))) {
      if (typeof onProgress === "function") {
        onProgress("Installing backend dependencies for executable build...");
      }
      await runCommandWithRetries("npm", ["install", "--no-audit", "--no-fund", "--omit=dev", "--legacy-peer-deps"], {
        cwd: backendDir,
        timeoutMs,
        onLog,
      }, [
        ["install", "--no-audit", "--no-fund", "--omit=dev"],
      ]);
    } else if (typeof onProgress === "function") {
      onProgress("Skipping backend/node_modules install (using root dependency install for packaging).");
    }

    if (forceInstall || (!fs.existsSync(electronBuilderCmd) && !fs.existsSync(electronBuilderBin))) {
      if (typeof onProgress === "function") {
        onProgress("Installing Electron dependencies...");
      }
      await runCommandWithRetries("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps", "--omit=optional"], {
        cwd: projectDir,
        timeoutMs,
        onLog,
      }, [
        ["install", "--no-audit", "--no-fund", "--omit=optional"],
      ]);
    } else if (typeof onProgress === "function") {
      onProgress("Using cached Electron dependencies.");
    }

    const distDir = path.join(projectDir, "dist");
    try {
      fs.rmSync(distDir, { recursive: true, force: true });
    } catch (_err) {
      // Ignore cleanup errors; builder may still work with existing files.
    }
    ensureDir(distDir);

    ensureSufficientDiskSpace(projectDir, Math.floor(minFreeBytes * 0.6));

    const buildAttempts = Number(process.env.AI_EXE_BUILD_ATTEMPTS || 2);
    const builderCommand = fs.existsSync(electronBuilderCmd)
      ? electronBuilderCmd
      : (fs.existsSync(electronBuilderBin) ? electronBuilderBin : "npx");
    const builderArgs = builderCommand === "npx"
      ? ["electron-builder", "--win", "portable", "--publish=never"]
      : ["--win", "portable", "--publish=never"];
    let buildErr = null;
    for (let attempt = 1; attempt <= Math.max(1, buildAttempts); attempt += 1) {
      try {
        if (typeof onProgress === "function") {
          onProgress(`Building Windows executable (.exe) with Electron Builder... (attempt ${attempt}/${Math.max(1, buildAttempts)})`);
        }
        await runCommand(builderCommand, builderArgs, {
          cwd: projectDir,
          timeoutMs,
          env: {
            CSC_IDENTITY_AUTO_DISCOVERY: "false",
            ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: "true",
          },
          onLog,
        });
        buildErr = null;
        break;
      } catch (err) {
        buildErr = err;
        const shouldRetry = attempt < Math.max(1, buildAttempts) && isRetryableBuildError(err);
        if (!shouldRetry) break;
        if (typeof onProgress === "function") {
          onProgress(`Electron build attempt ${attempt} failed (retrying): ${String(err?.message || "unknown error").slice(0, 180)}`);
        }
        await sleep(1800);
      }
    }
    if (buildErr) throw buildErr;

    const exePath = findFirstExe(distDir);
    if (!exePath) throw new Error("Electron build completed but no .exe artifact was found in dist");

    const relativeExePath = path.relative(projectDir, exePath).replace(/\\/g, "/");
    return {
      exePath,
      relativeExePath,
      downloadURL: `/generated_projects/${projectName}/${relativeExePath}`,
    };
  } catch (err) {
    throw normalizeExecutableBuildError(err);
  }
}

module.exports = {
  buildElectronExecutable,
};
