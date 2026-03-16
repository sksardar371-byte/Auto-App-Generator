const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const GENERATED_ROOT = path.join(__dirname, "..", "generated_projects");

function safeSlug(name) {
  const slug = String(name || "generated-app")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "generated-app";
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeResolve(baseDir, relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes(":")) {
    throw new Error(`Invalid file path: ${relativePath}`);
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedFile = path.resolve(baseDir, normalized);
  if (!resolvedFile.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Blocked path traversal: ${relativePath}`);
  }
  return resolvedFile;
}

function buildProject(projectData) {
  ensureDir(GENERATED_ROOT);

  const timestamp = Date.now();
  const projectName = `${safeSlug(projectData?.projectName)}-${timestamp}`;
  const projectDir = path.join(GENERATED_ROOT, projectName);
  ensureDir(projectDir);

  const files = Array.isArray(projectData?.files) ? projectData.files : [];
  if (!files.length) throw new Error("No files to write");

  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("Invalid file object in generated payload");
    }
    const absPath = safeResolve(projectDir, file.path);
    ensureDir(path.dirname(absPath));
    fs.writeFileSync(absPath, file.content, "utf8");
  }

  return { projectName, projectDir };
}

function getProjectDir(projectName) {
  if (!projectName) throw new Error("projectName is required");
  const abs = path.join(GENERATED_ROOT, String(projectName));
  if (!fs.existsSync(abs)) throw new Error("Project not found");
  return abs;
}

function writeFiles(projectDir, files) {
  if (!Array.isArray(files) || !files.length) throw new Error("No files to write");
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("Invalid file object in payload");
    }
    const absPath = safeResolve(projectDir, file.path);
    ensureDir(path.dirname(absPath));
    fs.writeFileSync(absPath, file.content, "utf8");
  }
}

function listProjectFiles(projectDir) {
  const out = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else {
        const rel = path.relative(projectDir, full).replace(/\\/g, "/");
        const ext = path.extname(rel).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".gif", ".zip", ".exe", ".ico", ".pdf"].includes(ext)) continue;
        const content = fs.readFileSync(full, "utf8");
        out.push({ path: rel, content });
      }
    }
  };
  walk(projectDir);
  return out;
}

async function zipProject(projectDir, zipFilePath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(projectDir, false);
    archive.finalize();
  });
}

module.exports = {
  GENERATED_ROOT,
  buildProject,
  getProjectDir,
  writeFiles,
  listProjectFiles,
  zipProject,
};
