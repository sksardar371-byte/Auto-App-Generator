const express = require("express");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
const { generateFromLLM } = require("../services/llmService");
const { parseJsonSafe } = require("../utils/jsonUtils");
const { validateGeneratedPayload } = require("../utils/validator");
const {
  buildProject,
  getProjectDir,
  writeFiles,
  listProjectFiles,
  zipProject,
} = require("../utils/projectBuilder");
const { startPreview, getPreviewStatus, stopPreview } = require("../utils/previewRunner");
const { buildElectronExecutable } = require("../utils/electronPackager");

const router = express.Router();
const generationProgress = new Map();
const TEMPLATE_ROOT = path.join(__dirname, "..", "templates");
const BASE_FRONTEND_TEMPLATE_DIR = path.join(TEMPLATE_ROOT, "base-fullstack", "frontend");
const AI_LOCK_DOMAIN_TEMPLATES = String(process.env.AI_LOCK_DOMAIN_TEMPLATES || "true").toLowerCase() !== "false";
const AI_ENFORCE_PRO_DASHBOARD = String(process.env.AI_ENFORCE_PRO_DASHBOARD || "true").toLowerCase() !== "false";
const AI_CREATE_PROJECT_DATABASES = String(process.env.AI_CREATE_PROJECT_DATABASES || "true").toLowerCase() !== "false";
const AI_ENABLE_IMAGE_ASSETS = String(process.env.AI_ENABLE_IMAGE_ASSETS || "true").toLowerCase() !== "false";
const AI_DEFAULT_IMAGE_COUNT = Math.max(1, Number(process.env.AI_IMAGE_COUNT || 4));
const AI_MAX_IMAGE_COUNT = 12;
const LOCKED_FRONTEND_FILES = [
  "index.html",
  "login.html",
  "register.html",
  "dashboard.html",
  "restaurants.html",
  "restaurant-menu.html",
  "cart.html",
  "checkout.html",
  "order-tracking.html",
  "profile.html",
  "owner-dashboard.html",
  "admin-dashboard.html",
  "delivery-dashboard.html",
  "dashboard.js",
  "dashboard.css",
  "login.js",
  "register.js",
  "script.js",
  "style.css",
  "css/global.css",
  "css/dashboard.css",
  "css/components.css",
  "js/api.js",
  "js/auth.js",
  "js/student.js",
  "js/instructor.js",
  "js/admin.js",
  "js/course.js",
  "js/quiz.js",
  "student/dashboard.html",
  "student/doctors.html",
  "student/my-courses.html",
  "student/course-player.html",
  "student/certificates.html",
  "student/quiz.html",
  "student/profile.html",
  "instructor/dashboard.html",
  "instructor/create-course.html",
  "instructor/manage-courses.html",
  "instructor/students.html",
  "instructor/earnings.html",
  "instructor/profile.html",
  "admin/dashboard.html",
  "admin/users.html",
  "admin/courses.html",
  "admin/categories.html",
  "admin/revenue.html",
  "admin/reports.html",
  "admin/settings.html",
  "public/course-catalog.html",
  "public/course-details.html",
  "public/instructor-profile.html",
];
const DYNAMIC_SHELL_FILES = new Set(["index.html", "login.html", "register.html", "style.css", "script.js", "login.js", "register.js"]);
const BASELINE_FRONTEND_FILES = [];
const DOMAIN_TEMPLATE_KEYWORDS = {
  fooddelivery: [
    "food delivery",
    "zomato",
    "swiggy",
    "restaurant",
    "menu",
    "dish",
    "cart",
    "checkout",
    "delivery partner",
    "order tracking",
    "biryani",
    "pizza",
    "burger",
  ],
  healthcare: ["clinic", "hospital", "hms", "hospital management", "doctor", "patient", "medical", "appointment", "prescription"],
  fitness: ["fitness", "workout", "gym", "diet", "nutrition", "meal plan", "exercise", "trainer"],
  lms: [
    "lms",
    "learning management",
    "learning management system",
    "udemy",
    "coursera",
    "skillshare",
    "instructor",
    "lecture",
    "lesson",
    "curriculum",
    "certificate",
    "quiz",
  ],
  education: [
    "education",
    "school",
    "college",
    "student",
    "course",
    "classroom",
    "teacher",
    "elearning",
    "e-learning",
  ],
  crm: ["crm", "lead", "pipeline", "sales", "customer relationship", "deal"],
  realestate: ["real estate", "property", "tenant", "lease", "maintenance request", "rent", "rental", "broker"],
  ecommerce: ["ecommerce", "e-commerce", "shop", "store", "catalog", "product", "order", "food delivery", "restaurant", "delivery agent", "rider", "menu"],
};
const ADAPTIVE_DOMAIN_KEY = "adaptive";
const LOCKED_DOMAIN_TEMPLATE_KEYS = new Set(["lms", "healthcare", "fooddelivery"]);

function isLockedDomainTemplateKey(domainKey) {
  return LOCKED_DOMAIN_TEMPLATE_KEYS.has(String(domainKey || "").toLowerCase());
}

function sanitizeRequestId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 80);
}

function upsertGenerationProgress(requestId, patch) {
  if (!requestId) return;
  const previous = generationProgress.get(requestId) || {};
  generationProgress.set(requestId, {
    requestId,
    status: "running",
    stage: previous.stage || "queued",
    message: previous.message || "",
    startedAt: previous.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch,
  });
}

function toBoundedPositiveInt(value, fallback, maxValue = AI_MAX_IMAGE_COUNT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Number(fallback) || 1);
  return Math.min(maxValue, Math.max(1, Math.floor(parsed)));
}

function promptRequestsRequirementImages(userPrompt) {
  const text = String(userPrompt || "").toLowerCase();
  if (!text.trim()) return false;
  const directSignals = [
    /\b(with|add|include|use|generate|create|show)\b[^.\n]{0,40}\b(images?|photos?|pictures?|banners?|thumbnails?|illustrations?)\b/i,
    /\bimage\s*(gallery|assets?|generation|generator)\b/i,
    /\bvisuals?\b/i,
  ];
  return directSignals.some((rx) => rx.test(text));
}

function deriveRequirementImageLabels(userPrompt, plan, maxCount = AI_MAX_IMAGE_COUNT) {
  const domainKey = detectDomainTemplateKey(userPrompt, plan);
  const labels = [];
  const seen = new Set();
  const add = (label) => {
    const cleaned = String(label || "").trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(cleaned);
  };

  add(`${toTitleCase(domainKey === ADAPTIVE_DOMAIN_KEY ? "application" : domainKey)} hero`);
  extractPromptModules(userPrompt, domainKey).forEach((item) => add(item));
  inferDashboardModules(userPrompt, plan, domainKey).forEach((item) => add(item?.label || ""));
  if (Array.isArray(plan?.entities)) plan.entities.forEach((item) => add(item));
  if (Array.isArray(plan?.pages)) {
    plan.pages
      .filter((page) => /home|landing|dashboard|catalog|listing|profile|menu/i.test(String(page || "")))
      .forEach((page) => add(String(page || "").replace(/[-_]+/g, " ")));
  }

  if (!labels.length) add("application dashboard");
  return labels.slice(0, Math.max(1, Number(maxCount) || 1));
}

function resolvePromptImageConfig(userPrompt, plan, options = {}) {
  const explicitInclude = String(options?.includeAiImages ?? "").toLowerCase() === "true";
  const requestedByPrompt = promptRequestsRequirementImages(userPrompt);
  const enabled = AI_ENABLE_IMAGE_ASSETS && (explicitInclude || requestedByPrompt);
  const count = toBoundedPositiveInt(options?.aiImageCount, AI_DEFAULT_IMAGE_COUNT);
  const labels = enabled ? deriveRequirementImageLabels(userPrompt, plan, Math.max(count, 3)) : [];
  return {
    enabled,
    count,
    labels,
  };
}

function buildImagePromptBlock(imageConfig = {}) {
  if (!imageConfig?.enabled) return "";
  const labelLines = (Array.isArray(imageConfig.labels) ? imageConfig.labels : [])
    .slice(0, Math.max(1, Number(imageConfig.count) || 1))
    .map((label) => `- ${label}`)
    .join("\n");
  return `
=================================================
IMAGE REQUIREMENTS (MANDATORY)
=================================================

- User requested requirement-related images.
- Add local image assets under frontend/assets/generated-images/.
- Use meaningful filenames and alt text tied to business modules.
- Reference those images in relevant UI sections (hero/cards/listing/dashboard).
- Do NOT use unrelated or random stock visuals.
- If remote images are unavailable, generate SVG placeholders locally.

Required image topics:
${labelLines || "- application hero\n- module cards"}
`;
}

const buildPlanPrompt = (userPrompt) => `You are a senior software architect.
Return ONLY valid JSON. No markdown.

Create an implementation-ready plan for this request:
"${userPrompt}"

Requirements:
- Infer exact app type and stack from the request.
- Extract explicit and implicit user requirements.
- Include concrete pages/routes/entities that are necessary.
- Include API and data requirements when backend/database/auth is implied.
- Avoid generic placeholders.

Output schema:
{
  "projectName": "kebab-name",
  "stack": "short stack name",
  "pages": ["..."],
  "routes": ["..."],
  "entities": ["..."],
  "notes": ["must-have behavior 1", "must-have behavior 2", "..."]
}`;

const buildFilesPrompt = (userPrompt, plan, imageConfig = {}) => `You are a senior full-stack engineer.
Return ONLY valid JSON. No markdown.

Generate COMPLETE runnable project files for this request:
"${userPrompt}"

Use this plan as contract:
${JSON.stringify(plan, null, 2)}

=================================================
GENERAL HARD RULES
=================================================

- Keep paths relative.
- files must be array of { "path": "...", "content": "..." }.
- Do NOT output placeholder/demo scaffold.
- Implement features in code, not just README text.
- Ensure all planned pages/routes/entities are represented in source files.
- Keep shell/auth template files stable: do not modify or regenerate index/login/register shell files unless explicitly requested.
- If frontend is required: include real UI, styling, and interaction logic.
- If backend/api/auth/database is required: include real endpoints/services/models.
- Ensure project can run with commands from README.

=================================================
MINIMUM QUALITY (REQUIRED)
=================================================

- Include README.md with exact install/run commands.
- Include package.json when Node/React/fullstack is used.
- Include backend/server.js for Node.js backend.
- Include frontend/index.html, frontend/style.css, frontend/script.js for frontend.
- Keep code logically connected across files.
- Include all necessary files for a complete working app.
${buildImagePromptBlock(imageConfig)}

Output schema:
{
  "projectName": "${plan.projectName || "generated-app"}",
  "files": [{ "path": "README.md", "content": "..." }]
}`;

const buildStrictFilesOnlyPrompt = (userPrompt, plan, imageConfig = {}) => `Return ONLY valid JSON with this exact schema:
{
  "projectName": "${plan.projectName || "generated-app"}",
  "files": [
    { "path": "package.json", "content": "..." }
  ]
}

Do NOT return project plan keys like stack/pages/routes/entities unless they are inside file content.
No markdown.
No explanation.
Output must implement the user request with concrete runnable logic, not a generic template.
Must include real code for required features and stack-appropriate entry files.
${buildImagePromptBlock(imageConfig)}

User request:
"${userPrompt}"
`;

const buildRepairPrompt = (plan, previousPayload, issues, imageConfig = {}) => `Fix this generated project payload.
Return ONLY valid JSON with:
{
  "projectName": "${plan.projectName || "generated-app"}",
  "files": [{ "path": "...", "content": "..." }]
}

Validation issues to fix:
${issues.map((i) => `- ${i}`).join("\n")}

Plan contract (must satisfy):
${JSON.stringify(plan, null, 2)}

Previous payload:
${JSON.stringify(previousPayload, null, 2)}

Repair rules:
- Keep valid files from previous payload.
- Replace incomplete/invalid files fully.
- Add any missing files required for the stack/features.
- Ensure code directly implements requested behavior.
${buildImagePromptBlock(imageConfig)}
`;

const buildRefinePlanPrompt = (changeRequest, previousPlan) => `You are a software architect.
Return ONLY valid JSON.
Given this previous plan:
${JSON.stringify(previousPlan, null, 2)}

Apply this change request:
"${changeRequest}"

Return updated plan with same schema.`;

const buildRefineFilesPrompt = (changeRequest, plan, projectFiles) => `You are a senior full-stack engineer.
Return ONLY valid JSON:
{
  "files": [{ "path": "...", "content": "..." }]
}

Update ONLY files impacted by this change request:
"${changeRequest}"

Plan:
${JSON.stringify(plan, null, 2)}

Current files:
${JSON.stringify(projectFiles.slice(0, 40), null, 2)}
`;

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") return false;
  return typeof plan.projectName === "string" && plan.projectName.trim().length > 0;
}

function validateFilePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (!Array.isArray(payload.files) || payload.files.length === 0) return false;
  return payload.files.every(
    (f) => f && typeof f.path === "string" && f.path.trim() && typeof f.content === "string"
  );
}

function toDbSafeProjectKey(value) {
  const cleaned = String(value || "generated-app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return cleaned || "generated_app";
}

function setEnvValue(envContent, key, value) {
  const lines = String(envContent || "").split(/\r?\n/);
  let found = false;
  const nextLines = lines.map((line) => {
    if (/^\s*#/.test(line)) return line;
    const idx = line.indexOf("=");
    if (idx <= 0) return line;
    const currentKey = line.slice(0, idx).trim();
    if (currentKey !== key) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) nextLines.push(`${key}=${value}`);
  return nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function readProjectDbConfig() {
  const parsedPort = Number(process.env.PROJECT_DB_PORT || process.env.DB_PORT || 3306);
  return {
    host: String(process.env.PROJECT_DB_HOST || process.env.DB_HOST || "127.0.0.1"),
    port: Number.isFinite(parsedPort) ? parsedPort : 3306,
    user: String(process.env.PROJECT_DB_USER || process.env.DB_USER || "root"),
    password: String(process.env.PROJECT_DB_PASSWORD || process.env.DB_PASSWORD || "1234"),
  };
}

function writePerProjectDatabaseEnv(projectDir, projectName, dbConfig = readProjectDbConfig()) {
  const dbName = `app_${toDbSafeProjectKey(projectName)}`.slice(0, 63);
  const targets = [
    path.join(projectDir, ".env"),
    path.join(projectDir, ".env.example"),
    path.join(projectDir, "backend", ".env"),
    path.join(projectDir, "backend", ".env.example"),
  ];

  for (const target of targets) {
    const hasExisting = fs.existsSync(target);
    let content = hasExisting ? fs.readFileSync(target, "utf8") : "";
    content = setEnvValue(content, "DB_HOST", dbConfig.host);
    content = setEnvValue(content, "DB_PORT", String(dbConfig.port));
    content = setEnvValue(content, "DB_USER", dbConfig.user);
    content = setEnvValue(content, "DB_PASSWORD", dbConfig.password);
    content = setEnvValue(content, "DB_NAME", dbName);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${content.trim()}\n`, "utf8");
  }

  return dbName;
}

async function ensureProjectDatabaseExists(dbName, dbConfig = readProjectDbConfig()) {
  const safeDb = String(dbName || "").replace(/`/g, "");
  if (!safeDb) throw new Error("Invalid project database name");
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end().catch(() => {});
  }
}

function normalizeFilePayload(payload, fallbackProjectName = "generated-app") {
  if (!payload) return null;

  const sanitizePath = (p) => {
    let out = String(p || "").replace(/\\/g, "/").trim();
    out = out.replace(/^\.?\//, "");
    while (out.startsWith("/")) out = out.slice(1);
    if (out.toLowerCase() === "readme") out = "README.md";
    return out;
  };

  // Case 1: model returns file array directly.
  if (Array.isArray(payload)) {
    return { projectName: fallbackProjectName, files: payload };
  }

  // Case 2: standard object variants.
  const files =
    payload.files ||
    payload.project_files ||
    payload.codebase ||
    payload.generated_files ||
    payload.output?.files ||
    payload.data?.files ||
    payload.result?.files;

  const projectName =
    payload.projectName ||
    payload.project_name ||
    payload.name ||
    payload.output?.projectName ||
    fallbackProjectName;

  if (Array.isArray(files)) {
    const mapped = files.map((f) => {
      if (!f || typeof f !== "object") return null;
      const filePath =
        f.path ||
        f.filePath ||
        f.file_path ||
        f.filename ||
        f.name ||
        f.target;
      const content =
        f.content ??
        f.code ??
        f.body ??
        f.text ??
        f.value;
      if (!filePath || typeof filePath !== "string") return null;
      return { path: sanitizePath(filePath), content: String(content ?? "") };
    }).filter(Boolean);
    return { projectName, files: mapped };
  }

  // Case 3: object map of path->content.
  const fileMap = payload.fileMap || payload.files_map || payload.output?.fileMap;
  if (fileMap && typeof fileMap === "object" && !Array.isArray(fileMap)) {
    const mapped = Object.entries(fileMap).map(([p, c]) => ({ path: sanitizePath(p), content: String(c ?? "") }));
    return { projectName, files: mapped };
  }

  return null;
}

function normalizePathKey(p) {
  return String(p || "").replace(/\\/g, "/").trim().toLowerCase();
}

function normalizeToPosixPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .trim();
}

function resolveMissingLocalImportPath(sourcePath, specifier) {
  const source = normalizeToPosixPath(sourcePath);
  const spec = String(specifier || "").trim();
  if (!source || !spec.startsWith(".")) return "";

  const sourceDir = path.posix.dirname(source);
  let resolved = path.posix.normalize(path.posix.join(sourceDir, spec));
  resolved = resolved.replace(/^(\.\.\/)+/, "");
  if (!path.posix.extname(resolved)) resolved += ".js";
  return normalizeToPosixPath(resolved);
}

function buildMissingModuleStubContent(targetPath, specifier = "") {
  const normalizedPath = normalizeToPosixPath(targetPath).toLowerCase();
  const normalizedSpecifier = String(specifier || "").toLowerCase();

  if (normalizedPath.endsWith(".json")) return "{}\n";

  if (normalizedPath.includes("/routes/") || normalizedSpecifier.includes("/routes/")) {
    return `const express = require("express");
const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ success: true, message: "Route ready" });
});

module.exports = router;
`;
  }

  if (normalizedPath.includes("/middleware/")) {
    return `function middleware(_req, _res, next) {
  next();
}

module.exports = middleware;
`;
  }

  if (normalizedPath.includes("/controllers/")) {
    return `module.exports = {
  health: (_req, res) => res.json({ success: true })
};
`;
  }

  if (normalizedPath.includes("/models/")) {
    return `module.exports = {};
`;
  }

  return `module.exports = {};
`;
}

function buildAuthMiddlewareTemplate() {
  return `function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  req.user = req.user || { token };
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    const expected = String(role || "").toLowerCase();
    const actual = String(req.user?.role || "").toLowerCase();
    if (!expected || actual === expected) return next();
    return res.status(403).json({ success: false, message: "Forbidden" });
  };
}

function auth(req, res, next) {
  return requireAuth(req, res, next);
}

auth.requireAuth = requireAuth;
auth.requireRole = requireRole;

module.exports = auth;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
`;
}

function buildGenericRunnableJsTemplate(targetPath) {
  const fileName = path.posix.basename(normalizeToPosixPath(targetPath) || "module.js");
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "");
  return `// Auto-healed file: ${safeName}
module.exports = {
  ready: true
};
`;
}

function patchLowQualityJsFiles(payload, validationIssues = []) {
  if (!payload || !Array.isArray(payload.files)) {
    return { payload, patchedFiles: [] };
  }

  const issueRegex = /(Too short content|Likely truncated\/incomplete file content|File does not look like runnable content):\s+(.+)$/i;
  const badPaths = new Set();
  for (const issue of validationIssues || []) {
    const text = String(issue || "");
    const match = text.match(issueRegex);
    if (!match) continue;
    const targetPath = normalizeToPosixPath(match[2] || "");
    if (!targetPath) continue;
    if (!targetPath.toLowerCase().endsWith(".js")) continue;
    badPaths.add(targetPath);
  }

  if (!badPaths.size) return { payload, patchedFiles: [] };

  const patchedFiles = [];
  const nextFiles = payload.files.map((file) => {
    const currentPath = normalizeToPosixPath(file?.path || "");
    if (!badPaths.has(currentPath)) return file;

    const lower = currentPath.toLowerCase();
    let content = "";
    if (/(^|\/)backend\/middleware\/auth\.js$/.test(lower) || /(^|\/)middleware\/auth\.js$/.test(lower)) {
      content = buildAuthMiddlewareTemplate();
    } else {
      content = buildGenericRunnableJsTemplate(currentPath);
    }

    patchedFiles.push(currentPath);
    return { ...file, content };
  });

  return {
    payload: {
      ...payload,
      files: nextFiles,
    },
    patchedFiles,
  };
}

function patchMissingLocalImports(payload, validationIssues = []) {
  if (!payload || !Array.isArray(payload.files)) {
    return { payload, addedFiles: [] };
  }

  const issueRegex = /Missing local module for import '([^']+)' referenced in ([^\s;]+)/i;
  const existingPaths = new Set(
    payload.files
      .map((file) => normalizePathKey(file?.path || ""))
      .filter(Boolean)
  );
  const additions = [];

  for (const issue of validationIssues || []) {
    const text = String(issue || "");
    const match = text.match(issueRegex);
    if (!match) continue;

    const specifier = String(match[1] || "").trim();
    const sourcePath = String(match[2] || "").trim();
    if (!specifier.startsWith(".")) continue;

    const resolvedPath = resolveMissingLocalImportPath(sourcePath, specifier);
    if (!resolvedPath) continue;
    const key = normalizePathKey(resolvedPath);
    if (!key || existingPaths.has(key)) continue;

    additions.push({
      path: resolvedPath,
      content: buildMissingModuleStubContent(resolvedPath, specifier),
    });
    existingPaths.add(key);
  }

  if (!additions.length) return { payload, addedFiles: [] };
  return {
    payload: {
      ...payload,
      files: [...payload.files, ...additions],
    },
    addedFiles: additions,
  };
}

function detectFrontendRoot(files) {
  const paths = (Array.isArray(files) ? files : [])
    .map((f) => normalizePathKey(f?.path || ""))
    .filter(Boolean);
  if (paths.some((p) => p.startsWith("frontend/"))) return "frontend";
  if (paths.some((p) => p.startsWith("public/"))) return "public";
  if (paths.some((p) => p === "index.html" || p.endsWith("/index.html"))) return "";
  return "frontend";
}

function parseForcedDomainTemplateKey(promptText) {
  const text = String(promptText || "").toLowerCase();
  const accepted = new Set([
    ADAPTIVE_DOMAIN_KEY,
    "fooddelivery",
    "healthcare",
    "lms",
    "education",
    "ecommerce",
    "realestate",
    "crm",
    "fitness",
  ]);
  const aliases = {
    generic: ADAPTIVE_DOMAIN_KEY,
    food: "fooddelivery",
    "food-delivery": "fooddelivery",
    "food_delivery": "fooddelivery",
    zomato: "fooddelivery",
    swiggy: "fooddelivery",
    hospital: "healthcare",
    hms: "healthcare",
    "hospital-management": "healthcare",
    "hospital_management": "healthcare",
    clinic: "healthcare",
    "real-estate": "realestate",
    "real_estate": "realestate",
    "e-commerce": "ecommerce",
  };
  const patterns = [
    /\bforce[_\s-]*domain(?:[_\s-]*template)?\s*[:=]\s*([a-z_-]+)\b/i,
    /\bdomain(?:[_\s-]*template)?\s*[:=]\s*([a-z_-]+)\b/i,
    /\buse\s+domain(?:\s+template)?\s+([a-z_-]+)\b/i,
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    if (!match || !match[1]) continue;
    const raw = String(match[1] || "").trim().toLowerCase();
    const mapped = aliases[raw] || raw;
    if (accepted.has(mapped)) return mapped;
  }
  return "";
}

function detectDomainTemplateKey(userPrompt, plan) {
  const forcedDomainKey = parseForcedDomainTemplateKey(userPrompt);
  if (forcedDomainKey) return forcedDomainKey;
  const promptText = String(userPrompt || "").toLowerCase();
  const parts = [
    String(userPrompt || ""),
    String(plan?.stack || ""),
    Array.isArray(plan?.pages) ? plan.pages.join(" ") : "",
    Array.isArray(plan?.entities) ? plan.entities.join(" ") : "",
    Array.isArray(plan?.notes) ? plan.notes.join(" ") : "",
  ];
  const text = parts.join(" ").toLowerCase();
  const neutralizedText = text
    // Ignore domain names when they appear only in exclusion/template guardrails.
    .replace(
      /\b(?:do\s+not\s+use|without|exclude|avoid|except|not)\b[^.\n]{0,220}\b(?:lms|learning\s*management(?:\s*system)?|hospital|hms|healthcare|clinic|medical|education)\b[^.\n]{0,220}\btemplates?\b/gi,
      " "
    )
    .replace(
      /\b(?:do\s+not\s+use|without|exclude|avoid|except|not)\b[^.\n]{0,180}\b(?:lms|learning\s*management(?:\s*system)?|hospital|hms|healthcare|clinic|medical|education)\b[^.\n]{0,180}\btemplates?\b/gi,
      " "
    )
    .replace(
      /\b(?:do\s+not\s+use|without|exclude|avoid|except|not)\b[^.\n]{0,180}\b(?:lms|learning\s*management(?:\s*system)?|hospital|hms|healthcare|clinic|medical|education)\b/gi,
      " "
    );
  const excludesHealthcareInPrompt =
    /\b(do\s+not\s+use|without|exclude|avoid|except|not)\b[^.\n]{0,220}\b(hospital|hms|healthcare|clinic|medical)\b/i.test(promptText);
  const excludesLmsInPrompt =
    /\b(do\s+not\s+use|without|exclude|avoid|except|not)\b[^.\n]{0,220}\b(lms|learning\s*management(?:\s*system)?|udemy|coursera|skillshare|education)\b/i.test(promptText);
  const excludesFoodDeliveryInPrompt =
    /\b(do\s+not\s+use|without|exclude|avoid|except|not)\b[^.\n]{0,220}\b(food\s*delivery|zomato|swiggy|restaurant|menu)\b/i.test(promptText);
  const explicitFoodDeliveryIntent =
    !excludesFoodDeliveryInPrompt &&
    /(food\s*delivery|zomato|swiggy|restaurant|menu|dish|delivery partner|order tracking|biryani|pizza|burger|cuisine)/i.test(promptText);
  const explicitHealthcareIntent =
    !excludesHealthcareInPrompt &&
    /(hospital|hms|clinic|patient|doctor|prescription|medical|appointment|lab|pharmacy)/i.test(promptText);
  const explicitLmsIntent =
    !excludesLmsInPrompt &&
    /(lms|learning\s*management(\s*system)?|udemy|coursera|skillshare|instructor|lecture|curriculum|certificate|quiz)/i.test(promptText);

  // Strong explicit hints first to avoid ambiguous keyword drift.
  // Important: healthcare must win over LMS when both appear in the same prompt
  // (for example: "build hospital app without overwriting my LMS project").
  if (explicitFoodDeliveryIntent && /(food\s*delivery|zomato|swiggy|restaurant|menu|dish|delivery\s*agent|delivery\s*partner|rider|tracking|biryani|pizza|burger|cuisine)/i.test(neutralizedText)) {
    return "fooddelivery";
  }
  if (explicitHealthcareIntent && /(hospital|hms|clinic|patient|doctor|prescription|medical|appointment|lab|pharmacy)/i.test(neutralizedText)) {
    return "healthcare";
  }
  if (explicitLmsIntent && /(lms|learning\s*management(\s*system)?|udemy|coursera|skillshare|instructor|lecture|curriculum|certificate|quiz)/i.test(neutralizedText)) {
    return "lms";
  }
  if (/(food\s*delivery|zomato|swiggy|restaurant|menu\s*items?|dish|biryani|pizza|burger|cuisine)/i.test(neutralizedText)) {
    return "fooddelivery";
  }
  if (/(real\s*estate|property|tenant|lease|broker|rental|rent\s*roll)/i.test(neutralizedText)) {
    return "realestate";
  }
  if (/(student|course|teacher|enrollment|classroom|education|e-?learning)/i.test(neutralizedText)) {
    return "education";
  }
  if (/(fitness|workout|gym|nutrition|diet|exercise|trainer)/i.test(neutralizedText)) {
    return "fitness";
  }
  if (/(crm|lead|pipeline|deal|sales)/i.test(neutralizedText)) {
    return "crm";
  }

  // Weighted fallback by keyword hits.
  let bestKey = ADAPTIVE_DOMAIN_KEY;
  let bestScore = 0;
  for (const [key, words] of Object.entries(DOMAIN_TEMPLATE_KEYWORDS)) {
    if (key === "healthcare" && (excludesHealthcareInPrompt || !explicitHealthcareIntent)) continue;
    if (key === "lms" && (excludesLmsInPrompt || !explicitLmsIntent)) continue;
    if (key === "fooddelivery" && excludesFoodDeliveryInPrompt) continue;
    const score = words.reduce((acc, word) => acc + (neutralizedText.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestScore > 0 ? bestKey : ADAPTIVE_DOMAIN_KEY;
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
}

function pickLabelFromSource(raw) {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const candidates = [
    raw.label,
    raw.name,
    raw.title,
    raw.entity,
    raw.module,
    raw.resource,
    raw.path,
    raw.route,
  ];
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

const DOMAIN_ENTITY_HINT_RE = /\b(patient|doctor|appointment|prescription|student|course|teacher|enroll(?:ment)?|member|workout|exercise|plan|progress|food|meal|nutrition|product|catalog|order|deliver(?:y|ies)|inventory|property|tenant|lease|maintenance|payment|lead|deal|activit(?:y|ies)|customer|restaurant|rider|shipment|invoice|report|task)\b/i;

function isInstructionLikeModuleText(value) {
  const text = String(value || "").toLowerCase();
  if (!text.trim()) return true;
  const instructionTerms = [
    "header",
    "sidebar",
    "content section",
    "content sections",
    "search",
    "filter",
    "sort",
    "pagination",
    "where relevant",
    "exact",
    "responsive",
    "layout",
    "theme",
    "ui",
    "ux",
    "flow",
    "login",
    "register",
    "dashboard",
    "jwt",
    "json",
    "api",
    "mysql",
    "postgres",
    "mongodb",
    "frontend",
    "backend",
    "crud",
    "roles",
    "permissions",
    "auth",
    "no mock data",
    "mock data",
    "proper relation",
    "proper relations",
    "sql table creation",
    "table creation",
    "auto create logic",
    "schema",
    "tables",
    "forms",
    "force domain template",
    "domain template",
    "template lock",
    "do not use",
    "app type",
    "tech stack",
  ];
  const hasInstruction = instructionTerms.some((term) => text.includes(term));
  if (!hasInstruction) return false;
  return !DOMAIN_ENTITY_HINT_RE.test(text);
}

function normalizeModuleLabel(rawValue) {
  let text = String(rawValue || "").trim();
  if (!text) return "";
  if (text === "/" || text === "/*") return "";

  // If it looks like a route path, use only the last meaningful segment.
  if (text.includes("/")) {
    const parts = text.split("/").map((x) => x.trim()).filter(Boolean);
    text = parts.length ? parts[parts.length - 1] : "";
  }

  text = text
    .replace(/\[object\s+object\]/gi, "")
    .replace(/[{}()[\]]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const lower = text.toLowerCase();
  const blocked = new Set([
    "index",
    "home",
    "landing",
    "intro",
    "introduction",
    "register",
    "registration",
    "login",
    "signin",
    "signup",
    "dashboard",
    "auth",
    "api",
    "frontend",
    "backend",
    "fullstack",
    "full stack",
    "business logic",
    "tech constraints",
    "technical constraints",
    "requirement",
    "requirements",
    "module",
    "modules",
    "feature",
    "features",
    "role",
    "roles",
    "admin",
    "user",
    "manager",
    "customer",
    "tenant",
    "agent",
    "doctor",
    "teacher",
    "trainer",
    "etc",
    "generic",
    "weak",
    "new lines",
    "new line",
    "lines",
    "kept",
    "line",
    "text",
    "output",
    "final",
    "result",
    "module records",
    "records",
    "force domain template",
    "domain template",
    "template lock",
    "template key",
    "app type",
    "tech stack",
  ]);
  if (blocked.has(lower)) return "";
  const blockedPhrasePattern = /\b(etc|generic|weak|new\s*lines?|kept|result|output|text)\b/i;
  if (blockedPhrasePattern.test(text) && !DOMAIN_ENTITY_HINT_RE.test(text)) return "";
  if (/^[a-z]{1,4}$/i.test(text) && !DOMAIN_ENTITY_HINT_RE.test(text)) return "";
  if (isInstructionLikeModuleText(text)) return "";
  if (/^(add|use|build|create|implement|manage|see|view|update)\b/i.test(text)) return "";
  if (/(live metric|json response|jwt|bcrypt|role based|dashboard logic|runnable|output)/i.test(text)) return "";
  if (/\b(no\s+mock\s+data|mock\s+data|proper\s+relations?|sql\s+table\s+creation|table\s+creation|auto\s*create\s*logic|forms?|tables?)\b/i.test(text) && !DOMAIN_ENTITY_HINT_RE.test(text)) return "";
  if (/\b(force\s+domain\s+template|domain\s+template|template\s+lock|template\s+key|app\s+type|tech\s+stack|strict\s+requirements?)\b/i.test(text) && !DOMAIN_ENTITY_HINT_RE.test(text)) return "";

  const noisePattern = /\b(mysql|postgres|mongodb|database|db|crud|full\s*crud|stack|frontend|backend|node|express|api|jwt|bcrypt|token|schema|migration|prompt|requirement|requirements)\b/i;
  if (noisePattern.test(text)) return "";

  return toTitleCase(text);
}

function extractPromptModules(userPrompt, domainKey) {
  const text = String(userPrompt || "");
  if (!text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const exactModuleSignals = [
    /use\s+modules?\s+exactly/i,
    /modules?\s+must\s+be\s+exactly/i,
    /exact\s+modules?/i,
  ];
  const stopSignals = [
    /admin permissions?/i,
    /user permissions?/i,
    /mandatory logic/i,
    /requirements?/i,
    /auth/i,
    /stack/i,
  ];
  const exactTokens = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;
    if (!exactModuleSignals.some((rx) => rx.test(line))) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 14); j += 1) {
      const nextLine = String(lines[j] || "").trim();
      if (!nextLine) break;
      if (stopSignals.some((rx) => rx.test(nextLine))) break;
      const cleaned = nextLine
        .replace(/^[\-\*\d\.\)\(]+\s*/, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim();
      if (!cleaned) continue;
      cleaned
        .split(/,|\/|\||;|\+|\band\b/gi)
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => exactTokens.push(x));
    }
    if (exactTokens.length) {
      return exactTokens;
    }
  }

  const explicit = [];
  const captureRegex = [
    /(?:modules?|tabs?|sections?|entities?|dashboard should include|include)\s*(?:must be exactly|are|=|:|-)?\s*([^\n.]+)/gi,
    /(?:modules?\s+must\s+be\s+exactly|modules?\s+are)\s*([^\n.]+)/gi,
    /(?:with modules?|with tabs?|containing)\s*[:\-]?\s*([^\n.]+)/gi,
  ];

  for (const rx of captureRegex) {
    let match;
    while ((match = rx.exec(text)) !== null) {
      explicit.push(String(match[1] || ""));
    }
  }

  const tokens = [];
  const pushToken = (raw) => {
    const cleaned = String(raw || "")
      .replace(/\(\s*crud\s*\)/gi, " ")
      .replace(/\bfull\s+crud\b/gi, " ")
      .replace(/\bcrud\b/gi, " ")
      .replace(/\bcreate\b/gi, " ")
      .replace(/\bread\b/gi, " ")
      .replace(/\bupdate\b/gi, " ")
      .replace(/\bdelete\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return;
    tokens.push(cleaned);
  };
  for (const chunk of explicit) {
    chunk
      .split(/,|\/|\||;|\+|\n|\band\b/gi)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => pushToken(x));
  }

  const bulletMatches = text.match(/^[\t ]*[-*]\s*([A-Za-z][^\n:]{2,80})$/gm) || [];
  for (const item of bulletMatches) {
    const cleaned = String(item).replace(/^[\t ]*[-*]\s*/, "").trim();
    if (cleaned) pushToken(cleaned);
  }

  // Parse keyed requirement lines like:
  // - Core: products CRUD, supplier CRUD, purchase entries, sales entries
  // - Modules: ...
  // - Entities: ...
  // - Features: ...
  const keyedLines = text.match(/^[\t ]*[-*]?\s*([A-Za-z][A-Za-z _-]{1,24})\s*:\s*([^\n]+)/gm) || [];
  const acceptedKeys = new Set(["core", "module", "modules", "entity", "entities", "feature", "features", "resource", "resources"]);
  for (const rawLine of keyedLines) {
    const match = String(rawLine || "").match(/^[\t ]*[-*]?\s*([A-Za-z][A-Za-z _-]{1,24})\s*:\s*([^\n]+)/);
    if (!match) continue;
    const key = String(match[1] || "").trim().toLowerCase();
    if (!acceptedKeys.has(key)) continue;
    const value = String(match[2] || "").trim();
    if (!value) continue;
    value
      .split(/,|\/|\||;|\+|\band\b/gi)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => pushToken(x));
  }

  // Domain-specific direct extraction fallback from whole prompt
  const lower = text.toLowerCase();
  if (domainKey === "fooddelivery" && /(food|menu|delivery|restaurant|zomato|swiggy|dish|cuisine)/.test(lower)) {
    tokens.push("restaurants", "menu items", "orders", "carts", "deliveries", "reviews");
  }
  if (domainKey === "ecommerce" && /(food|menu|delivery|restaurant)/.test(lower)) {
    tokens.push("food items", "orders", "deliveries", "customers");
  }
  if (domainKey === "fitness" && /(nutrition|diet|meal|calorie|macro)/.test(lower)) {
    tokens.push("food catalog", "diet plans", "meal logs", "progress");
  }
  if (domainKey === "healthcare" && /(clinic|doctor|patient|prescription|appointment)/.test(lower)) {
    tokens.push("patients", "appointments", "doctors", "prescriptions");
  }
  if (domainKey === "education" && /(student|course|teacher|enrollment|class)/.test(lower)) {
    tokens.push("students", "courses", "teachers", "enrollments");
  }
  if (domainKey === "lms" && /(course|module|lesson|lecture|instructor|student|enroll|assignment|quiz|certificate|review|payment)/.test(lower)) {
    tokens.push("courses", "modules", "lectures", "enrollments", "assignments", "quizzes", "certificates");
  }
  if (domainKey === "realestate" && /(property|tenant|lease|maintenance|rent|payment|agent)/.test(lower)) {
    tokens.push("properties", "tenants", "leases", "maintenance requests", "payments");
  }

  return tokens;
}

function safeModuleKey(value) {
  const out = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return out || "records";
}

function normalizeRoleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function humanizeFieldName(fieldName) {
  return String(fieldName || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferFieldTypeByName(name) {
  const key = String(name || "").toLowerCase();
  if (/status/.test(key)) return "status";
  if (/(date|dob|start|end)/.test(key)) return "date";
  if (/(time)/.test(key)) return "time";
  if (/(amount|price|cost|fee|rent|stock|qty|quantity|calorie|protein|carb|fat|value|count|score)/.test(key)) return "number";
  if (/(description|notes|address|summary|details|remark)/.test(key)) return "textarea";
  return "text";
}

function buildFieldsFromNames(names) {
  const unique = Array.from(new Set((Array.isArray(names) ? names : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)));
  const fields = unique.map((raw) => {
    const normalized = String(raw)
      .replace(/[^a-zA-Z0-9_ -]/g, "")
      .trim();
    const name = normalized
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!name) return null;
    const type = inferFieldTypeByName(name);
    return {
      name,
      label: humanizeFieldName(name),
      type,
      required: type !== "textarea",
    };
  }).filter(Boolean);
  return fields;
}

function extractFieldMapFromPrompt(userPrompt) {
  const text = String(userPrompt || "");
  const map = {};
  if (!text.trim()) return map;

  const linePattern = /(^|\n)\s*(?:[-*]\s*)?([A-Za-z][A-Za-z0-9 &/_-]{2,40})\s*:\s*([A-Za-z0-9_,\s/-]{6,260})/g;
  let match;
  while ((match = linePattern.exec(text)) !== null) {
    const moduleLabel = normalizeModuleLabel(match[2] || "");
    if (!moduleLabel) continue;
    const fieldNames = String(match[3] || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const built = buildFieldsFromNames(fieldNames);
    if (built.length >= 2) {
      map[safeModuleKey(moduleLabel)] = built;
    }
  }
  return map;
}

function isStrictModuleRequest(userPrompt) {
  const text = String(userPrompt || "").toLowerCase();
  return /(must be exactly|exact modules|only these modules|no extra modules|do not add extra modules|modules must be)/.test(text);
}

function mergeUniqueModuleSources(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const label = normalizeModuleLabel(raw);
    if (!label) continue;
    const key = safeModuleKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function inferFieldsForModule(labelRaw) {
  const label = String(labelRaw || "").toLowerCase();
  const common = [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "status", label: "Status", type: "status", required: true },
    { name: "description", label: "Description", type: "textarea", required: false },
  ];
  if (/(food|menu|product|inventory|item)/.test(label)) {
    return [
      { name: "name", label: "Item Name", type: "text", required: true },
      { name: "category", label: "Category", type: "text", required: true },
      { name: "price", label: "Price", type: "number", required: true },
      { name: "stock", label: "Stock", type: "number", required: true },
      { name: "status", label: "Status", type: "status", required: true },
    ];
  }
  if (/(patient|doctor|clinic|medical)/.test(label)) {
    return [
      { name: "name", label: "Full Name", type: "text", required: true },
      { name: "phone", label: "Phone", type: "text", required: false },
      { name: "email", label: "Email", type: "text", required: false },
      { name: "status", label: "Status", type: "status", required: true },
      { name: "notes", label: "Notes", type: "textarea", required: false },
    ];
  }
  if (/(appointment|booking|schedule|session)/.test(label)) {
    return [
      { name: "name", label: "Title", type: "text", required: true },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "time", label: "Time", type: "time", required: true },
      { name: "status", label: "Status", type: "status", required: true },
      { name: "notes", label: "Notes", type: "textarea", required: false },
    ];
  }
  if (/(student|course|class|teacher|education)/.test(label)) {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "email", label: "Email", type: "text", required: false },
      { name: "section", label: "Section", type: "text", required: false },
      { name: "status", label: "Status", type: "status", required: true },
      { name: "notes", label: "Notes", type: "textarea", required: false },
    ];
  }
  if (/(lead|deal|customer|crm|sales)/.test(label)) {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "email", label: "Email", type: "text", required: false },
      { name: "phone", label: "Phone", type: "text", required: false },
      { name: "status", label: "Status", type: "status", required: true },
      { name: "value", label: "Estimated Value", type: "number", required: false },
    ];
  }
  if (/(property|properties|real estate|listing)/.test(label)) {
    return [
      { name: "title", label: "Property Title", type: "text", required: true },
      { name: "type", label: "Type", type: "text", required: true },
      { name: "location", label: "Location", type: "text", required: true },
      { name: "rentAmount", label: "Rent Amount", type: "number", required: true },
      { name: "status", label: "Status", type: "status", required: true },
    ];
  }
  if (/(tenant|lease|maintenance|payment|agent|broker)/.test(label)) {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "email", label: "Email", type: "text", required: false },
      { name: "phone", label: "Phone", type: "text", required: false },
      { name: "status", label: "Status", type: "status", required: true },
      { name: "notes", label: "Notes", type: "textarea", required: false },
    ];
  }
  return common;
}

function getDefaultDomainModules(domainKey) {
  if (domainKey === "fooddelivery") return ["restaurants", "menu items", "orders", "carts", "deliveries", "reviews"];
  if (domainKey === "healthcare") return ["patients", "doctors", "appointments", "prescriptions"];
  if (domainKey === "fitness") return ["members", "workouts", "plans", "progress"];
  if (domainKey === "lms") return ["courses", "modules", "lectures", "enrollments", "assignments", "quizzes", "certificates", "reviews", "payments"];
  if (domainKey === "education") return ["students", "courses", "teachers", "enrollments"];
  if (domainKey === "crm") return ["leads", "customers", "deals", "activities"];
  if (domainKey === "realestate") return ["properties", "tenants", "leases", "maintenance requests", "payments"];
  if (domainKey === "ecommerce") return ["products", "orders", "inventory", "deliveries"];
  if (domainKey === ADAPTIVE_DOMAIN_KEY) return ["records", "workflows", "transactions", "reports"];
  return ["records", "operations", "tasks", "reports"];
}

function getPromptDrivenModules(userPrompt, domainKey) {
  const text = String(userPrompt || "").toLowerCase();
  if (domainKey === "fooddelivery") {
    return ["restaurants", "menu items", "orders", "carts", "deliveries", "reviews"];
  }
  if (domainKey === "ecommerce") {
    if (/(food|restaurant|delivery|menu|zomato|swiggy)/.test(text)) {
      return ["food items", "orders", "deliveries", "customers"];
    }
    return ["products", "orders", "inventory", "deliveries"];
  }
  if (domainKey === "healthcare") {
    return ["patients", "appointments", "doctors", "prescriptions"];
  }
  if (domainKey === "lms") {
    return ["courses", "lectures", "enrollments", "assignments", "quizzes", "certificates", "reviews", "payments"];
  }
  if (domainKey === "education") {
    return ["students", "courses", "teachers", "enrollments"];
  }
  if (domainKey === "fitness") {
    return ["members", "workouts", "plans", "progress"];
  }
  if (domainKey === "crm") {
    return ["leads", "customers", "deals", "activities"];
  }
  if (domainKey === "realestate") {
    return ["properties", "tenants", "leases", "maintenance requests", "payments"];
  }
  if (domainKey === ADAPTIVE_DOMAIN_KEY) {
    const candidates = [];
    const add = (label) => {
      const normalized = normalizeModuleLabel(label);
      if (!normalized) return;
      if (candidates.includes(normalized)) return;
      candidates.push(normalized);
    };
    const rules = [
      { rx: /\b(appointment|booking|schedule|slot)\b/, label: "appointments" },
      { rx: /\b(order|purchase|sale|checkout)\b/, label: "orders" },
      { rx: /\b(invoice|billing)\b/, label: "invoices" },
      { rx: /\b(payment|payout|transaction)\b/, label: "payments" },
      { rx: /\b(customer|client|member)\b/, label: "customers" },
      { rx: /\b(vendor|supplier|partner)\b/, label: "vendors" },
      { rx: /\b(product|catalog|item|sku)\b/, label: "products" },
      { rx: /\b(inventory|stock|warehouse)\b/, label: "inventory" },
      { rx: /\b(project|task|sprint|milestone)\b/, label: "tasks" },
      { rx: /\b(ticket|issue|support|complaint)\b/, label: "tickets" },
      { rx: /\b(staff|employee|attendance|payroll|hr)\b/, label: "staff" },
      { rx: /\b(asset|equipment|device)\b/, label: "assets" },
      { rx: /\b(delivery|shipment|dispatch|fleet|route)\b/, label: "deliveries" },
      { rx: /\b(report|analytics|insight|kpi|metric)\b/, label: "reports" },
      { rx: /\b(event|registration|attendee)\b/, label: "events" },
    ];
    for (const rule of rules) {
      if (rule.rx.test(text)) add(rule.label);
      if (candidates.length >= 6) break;
    }
    return candidates;
  }
  return [];
}

function inferDashboardModules(userPrompt, plan, domainKey) {
  const promptFieldMap = extractFieldMapFromPrompt(userPrompt);
  const strictModules = isStrictModuleRequest(userPrompt);
  const explicitPromptModules = extractPromptModules(userPrompt, domainKey);
  const explicitFromFields = Object.keys(promptFieldMap).map((k) => humanizeFieldName(k));
  const sources = [];
  const explicitSources = mergeUniqueModuleSources([...explicitPromptModules, ...explicitFromFields]);

  // Requirement-first: if user provided explicit modules, do not inject domain defaults first.
  if (explicitSources.length) {
    sources.push(...explicitSources);
  } else {
    const promptDriven = getPromptDrivenModules(userPrompt, domainKey);
    sources.push(...promptDriven);
    // If prompt-derived modules are already informative, avoid noisy entity drift from model plans.
    const shouldUsePlanEntities = promptDriven.length < 3;
    if (shouldUsePlanEntities && Array.isArray(plan?.entities)) sources.push(...plan.entities);
    if (!sources.length) sources.push(...getDefaultDomainModules(domainKey));
  }

  const modules = [];
  for (const raw of sources) {
    const candidate = pickLabelFromSource(raw);
    const label = normalizeModuleLabel(candidate || raw);
    if (!label) continue;
    const key = safeModuleKey(label);
    if (modules.some((m) => m.key === key)) continue;
    modules.push({
      key,
      label,
      fields: promptFieldMap[key] && promptFieldMap[key].length
        ? promptFieldMap[key]
        : inferFieldsForModule(label),
    });
    if (modules.length >= 6) break;
  }

  const bannedModuleKeys = new Set([
    "exact",
    "header",
    "sidebar",
    "search",
    "filter",
    "sort",
    "pagination",
    "where_relevant",
    "content",
    "content_sections",
    "operations_workspace",
    "force_domain_template",
    "domain_template",
    "template_lock",
    "template_key",
    "app_type",
    "tech_stack",
  ]);
  let cleanedModules = modules.filter((m) => !bannedModuleKeys.has(String(m?.key || "")));

  // Fill defaults only when request did not explicitly define modules (or strict set was not recognized).
  if ((!explicitSources.length && !strictModules) || (!strictModules && cleanedModules.length < 2)) {
    const defaults = getDefaultDomainModules(domainKey);
    for (const raw of defaults) {
      if (cleanedModules.length >= 4) break;
      const label = normalizeModuleLabel(raw);
      if (!label) continue;
      const key = safeModuleKey(label);
      if (cleanedModules.some((m) => m.key === key)) continue;
      cleanedModules.push({
        key,
        label,
        fields: promptFieldMap[key] && promptFieldMap[key].length
          ? promptFieldMap[key]
          : inferFieldsForModule(label),
      });
    }
  }

  // If strict modules were requested, keep only strict/prompt-driven modules and avoid generic defaults.
  if (strictModules && cleanedModules.length) {
    return cleanedModules.slice(0, 6);
  }

  if (!cleanedModules.length) {
    for (const raw of getDefaultDomainModules(domainKey)) {
      const label = toTitleCase(raw);
      cleanedModules.push({
        key: safeModuleKey(raw),
        label,
        fields: promptFieldMap[safeModuleKey(raw)] && promptFieldMap[safeModuleKey(raw)].length
          ? promptFieldMap[safeModuleKey(raw)]
          : inferFieldsForModule(label),
      });
    }
  }
  return cleanedModules;
}

function getDomainTheme(domainKey) {
  if (domainKey === "fooddelivery") {
    return { bg: "#fffaf7", panel: "#ffffff", primary: "#e23744", accent: "#ff6b6b", text: "#1c1c1c" };
  }
  if (domainKey === "healthcare") {
    return { bg: "#f4f8ff", panel: "#ffffff", primary: "#1d4ed8", accent: "#0ea5e9", text: "#0f172a" };
  }
  if (domainKey === "fitness") {
    return { bg: "#f7fdf8", panel: "#ffffff", primary: "#15803d", accent: "#22c55e", text: "#0b2e13" };
  }
  if (domainKey === "lms") {
    return { bg: "#f5f7ff", panel: "#ffffff", primary: "#1d4ed8", accent: "#0ea5e9", text: "#0f172a" };
  }
  if (domainKey === "education") {
    return { bg: "#f8f7ff", panel: "#ffffff", primary: "#4338ca", accent: "#6366f1", text: "#1e1b4b" };
  }
  if (domainKey === "crm") {
    return { bg: "#f7fbff", panel: "#ffffff", primary: "#0f766e", accent: "#14b8a6", text: "#052e2b" };
  }
  if (domainKey === "realestate") {
    return { bg: "#f8fafc", panel: "#ffffff", primary: "#1d4ed8", accent: "#0ea5e9", text: "#0f172a" };
  }
  if (domainKey === "ecommerce") {
    return { bg: "#fffaf5", panel: "#ffffff", primary: "#b45309", accent: "#f59e0b", text: "#3b1d00" };
  }
  if (domainKey === ADAPTIVE_DOMAIN_KEY) {
    return { bg: "#f7fafc", panel: "#ffffff", primary: "#0f766e", accent: "#06b6d4", text: "#0f172a" };
  }
  return { bg: "#f8fafc", panel: "#ffffff", primary: "#1f2937", accent: "#334155", text: "#0f172a" };
}

function getDomainStyleProfile(domainKey) {
  if (domainKey === "fooddelivery") {
    return {
      className: "style-fooddelivery",
      icon: "🍽",
      subtitle: "Restaurant discovery, carts, and live delivery tracking",
      metricLabels: ["Live Restaurants", "Orders Today", "Avg Delivery Time"],
      fontStack: "\"Segoe UI\", \"Trebuchet MS\", Arial, sans-serif",
    };
  }
  if (domainKey === "lms") {
    return {
      className: "style-lms",
      icon: "LMS",
      subtitle: "Course delivery, grading, and learner progress",
      metricLabels: ["Total Courses", "Active Enrollments", "Certificates Issued"],
      fontStack: "\"Segoe UI\", \"Trebuchet MS\", Arial, sans-serif",
    };
  }
  if (domainKey === "healthcare") {
    return {
      className: "style-healthcare",
      icon: "🩺",
      subtitle: "Clinical operations and patient lifecycle",
      metricLabels: ["Total Patients", "Active Cases", "Appointments Today"],
      fontStack: "\"Segoe UI\", \"Trebuchet MS\", Arial, sans-serif",
    };
  }
  if (domainKey === "fitness") {
    return {
      className: "style-fitness",
      icon: "🏋️",
      subtitle: "Training workflow and progress tracking",
      metricLabels: ["Total Members", "Active Plans", "Sessions Today"],
      fontStack: "\"Segoe UI\", \"Franklin Gothic Medium\", Arial, sans-serif",
    };
  }
  if (domainKey === "education") {
    return {
      className: "style-education",
      icon: "🎓",
      subtitle: "Academic records and class operations",
      metricLabels: ["Total Students", "Active Courses", "Updates Today"],
      fontStack: "\"Segoe UI\", \"Gill Sans\", Arial, sans-serif",
    };
  }
  if (domainKey === "crm") {
    return {
      className: "style-crm",
      icon: "📈",
      subtitle: "Pipeline visibility and customer operations",
      metricLabels: ["Total Leads", "Open Deals", "Updated Today"],
      fontStack: "\"Segoe UI\", \"Arial Narrow\", Arial, sans-serif",
    };
  }
  if (domainKey === "realestate") {
    return {
      className: "style-realestate",
      icon: "🏢",
      subtitle: "Property lifecycle and tenancy operations",
      metricLabels: ["Total Properties", "Active Leases", "Updates Today"],
      fontStack: "\"Segoe UI\", \"Tahoma\", Arial, sans-serif",
    };
  }
  if (domainKey === "ecommerce") {
    return {
      className: "style-ecommerce",
      icon: "🛒",
      subtitle: "Catalog, order, and delivery control center",
      metricLabels: ["Total Records", "Active", "Updated Today"],
      fontStack: "\"Segoe UI\", \"Verdana\", Arial, sans-serif",
    };
  }
  if (domainKey === ADAPTIVE_DOMAIN_KEY) {
    return {
      className: "style-adaptive",
      icon: "APP",
      subtitle: "Requirement-driven command workspace",
      metricLabels: ["Total Records", "Active Workflows", "Updated Today"],
      fontStack: "\"Manrope\", \"Segoe UI\", Arial, sans-serif",
    };
  }
  return {
    className: "style-generic",
    icon: "⚙️",
    subtitle: "Role-based live module management",
    metricLabels: ["Total Records", "Active", "Updated Today"],
    fontStack: "\"Segoe UI\", Arial, sans-serif",
  };
}

function getDomainLayoutProfile(domainKey) {
  if (domainKey === "fooddelivery") {
    return { layoutClass: "layout-fooddelivery", workspaceLabel: "Food Delivery Operations Workspace" };
  }
  if (domainKey === "healthcare") {
    return { layoutClass: "layout-healthcare", workspaceLabel: "Care Operations Workspace" };
  }
  if (domainKey === "lms") {
    return { layoutClass: "layout-lms", workspaceLabel: "Learning Platform Workspace" };
  }
  if (domainKey === "ecommerce") {
    return { layoutClass: "layout-ecommerce", workspaceLabel: "Commerce Control Workspace" };
  }
  if (domainKey === "education") {
    return { layoutClass: "layout-education", workspaceLabel: "Academic Operations Workspace" };
  }
  if (domainKey === "fitness") {
    return { layoutClass: "layout-fitness", workspaceLabel: "Training Operations Workspace" };
  }
  if (domainKey === "crm") {
    return { layoutClass: "layout-crm", workspaceLabel: "Pipeline Operations Workspace" };
  }
  if (domainKey === "realestate") {
    return { layoutClass: "layout-ecommerce", workspaceLabel: "Property Operations Workspace" };
  }
  if (domainKey === ADAPTIVE_DOMAIN_KEY) {
    return { layoutClass: "layout-adaptive", workspaceLabel: "Adaptive Operations Workspace" };
  }
  return { layoutClass: "layout-generic", workspaceLabel: "Operations Workspace" };
}

function getDashboardVisualProfiles(domainKey) {
  const shared = [
    {
      key: "executive",
      className: "visual-executive",
      subtitleSuffix: "Executive control view",
    },
    {
      key: "airy",
      className: "visual-airy",
      subtitleSuffix: "Modern workspace",
    },
    {
      key: "slate",
      className: "visual-slate",
      subtitleSuffix: "Operations matrix view",
    },
  ];

  if (domainKey === "healthcare") {
    return [
      { key: "executive", className: "visual-executive", subtitleSuffix: "Care command center" },
      { key: "airy", className: "visual-airy", subtitleSuffix: "Clinical workflow view" },
      { key: "slate", className: "visual-slate", subtitleSuffix: "Medical operations matrix" },
    ];
  }
  if (domainKey === "fooddelivery") {
    return [
      { key: "executive", className: "visual-executive", subtitleSuffix: "Restaurant operations command center" },
      { key: "airy", className: "visual-airy", subtitleSuffix: "Customer food discovery view" },
      { key: "slate", className: "visual-slate", subtitleSuffix: "Dispatch and delivery matrix" },
    ];
  }
  if (domainKey === "ecommerce") {
    return [
      { key: "executive", className: "visual-executive", subtitleSuffix: "Commerce command center" },
      { key: "airy", className: "visual-airy", subtitleSuffix: "Catalog operations view" },
      { key: "slate", className: "visual-slate", subtitleSuffix: "Fulfillment matrix view" },
    ];
  }
  if (domainKey === "lms") {
    return [
      { key: "executive", className: "visual-executive", subtitleSuffix: "Learning operations command center" },
      { key: "airy", className: "visual-airy", subtitleSuffix: "Course delivery workspace" },
      { key: "slate", className: "visual-slate", subtitleSuffix: "Instruction and analytics matrix" },
    ];
  }
  if (domainKey === "education") {
    return [
      { key: "executive", className: "visual-executive", subtitleSuffix: "Academic control room" },
      { key: "airy", className: "visual-airy", subtitleSuffix: "Learning operations view" },
      { key: "slate", className: "visual-slate", subtitleSuffix: "Campus matrix view" },
    ];
  }
  if (domainKey === "realestate") {
    return [
      { key: "executive", className: "visual-executive", subtitleSuffix: "Property command center" },
      { key: "airy", className: "visual-airy", subtitleSuffix: "Leasing operations view" },
      { key: "slate", className: "visual-slate", subtitleSuffix: "Portfolio matrix view" },
    ];
  }
  return shared;
}

function pickDashboardVisualVariant(userPrompt, plan, domainKey, modules) {
  const promptText = String(userPrompt || "").toLowerCase();
  const profiles = getDashboardVisualProfiles(domainKey);

  if (/\b(minimal|clean|simple|light)\b/.test(promptText)) {
    return profiles.find((p) => p.key === "airy") || profiles[0];
  }
  if (/\b(enterprise|admin|control|operations|analytics)\b/.test(promptText)) {
    return profiles.find((p) => p.key === "executive") || profiles[0];
  }
  if (/\b(modern|dark|pro|matrix)\b/.test(promptText)) {
    return profiles.find((p) => p.key === "slate") || profiles[0];
  }

  const seed = [
    String(userPrompt || ""),
    String(plan?.projectName || ""),
    String(domainKey || ""),
    (Array.isArray(modules) ? modules.map((m) => String(m?.key || "")).join(",") : ""),
  ].join("|");
  return profiles[hashString(seed) % profiles.length];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashString(value) {
  let hash = 0;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

function pickShellStyleVariant(userPrompt, plan, styleSeed = "") {
  const variants = [
    { key: "aurora", introLayout: "intro-split", authLayout: "auth-split" },
    { key: "linen", introLayout: "intro-stack", authLayout: "auth-card" },
    { key: "graphite", introLayout: "intro-wide", authLayout: "auth-reverse" },
    { key: "mint", introLayout: "intro-card-grid", authLayout: "auth-soft" },
  ];
  const promptText = String(userPrompt || "").toLowerCase();
  if (/\b(clean|minimal|simple|white|light)\b/.test(promptText)) {
    return variants.find((v) => v.key === "linen") || variants[0];
  }
  if (/\b(enterprise|bank|finance|audit|legal|control center)\b/.test(promptText)) {
    return variants.find((v) => v.key === "graphite") || variants[0];
  }
  if (/\b(creative|media|portfolio|design|studio|brand)\b/.test(promptText)) {
    return variants.find((v) => v.key === "aurora") || variants[0];
  }
  if (/\b(health|wellness|clinic|hospital|care)\b/.test(promptText)) {
    return variants.find((v) => v.key === "mint") || variants[0];
  }
  const seedInput = [
    String(styleSeed || ""),
    String(userPrompt || ""),
    String(plan?.projectName || ""),
  ].join("|");
  return variants[hashString(seedInput) % variants.length];
}

function getDomainShellCopy(domainKey) {
  if (domainKey === "fooddelivery") {
    return {
      title: "Food Delivery Command",
      introKicker: "Food Commerce Workflow",
      introPurpose: "Discover restaurants, browse menus, manage carts, and track deliveries with role-based control for customers, partners, and admins.",
      authTitle: "Food Platform Access",
      authDescription: "Sign in to manage customer orders, menus, dispatch, and fulfillment workflows.",
      highlights: ["Restaurant discovery", "Menu and cart flow", "Checkout and payments", "Live order tracking"],
    };
  }
  if (domainKey === "healthcare") {
    return {
      title: "Healthcare Operations Suite",
      introKicker: "Clinical Workflow",
      introPurpose: "Coordinate patients, appointments, prescriptions, and provider operations in one secure platform.",
      authTitle: "Secure Clinical Access",
      authDescription: "Use your account to manage real-time care operations and clinical records.",
      highlights: ["Patient lifecycle", "Appointment scheduling", "Prescription coordination", "Role-based access"],
    };
  }
  if (domainKey === "fitness") {
    return {
      title: "Fitness Performance Hub",
      introKicker: "Training Workflow",
      introPurpose: "Manage workout plans, progress tracking, coaching updates, and member engagement from one dashboard.",
      authTitle: "Welcome Back",
      authDescription: "Sign in to manage daily training operations and member progress.",
      highlights: ["Program planning", "Workout tracking", "Diet and progress logs", "Coach-member collaboration"],
    };
  }
  if (domainKey === "lms") {
    return {
      title: "Learning Management Platform",
      introKicker: "LMS Workflow",
      introPurpose: "Run a real LMS with course publishing, enrollments, classroom delivery, grading, certificates, and learner analytics.",
      authTitle: "LMS Access",
      authDescription: "Sign in as admin, instructor, or student to manage and learn through production-style workflows.",
      highlights: ["Role-based LMS dashboards", "Course and lecture management", "Assignments, quizzes, certificates", "Enrollment and payment tracking"],
    };
  }
  if (domainKey === "education") {
    return {
      title: "LMS Operations Platform",
      introKicker: "Learning Workflow",
      introPurpose: "Manage courses, cohorts, assignments, and learner progress with secure role-based LMS workflows.",
      authTitle: "LMS Access",
      authDescription: "Continue to your dashboard to manage course delivery, instructor activity, and learner outcomes.",
      highlights: ["Course catalog", "Learner progress", "Assignment tracking", "Instructor workflows"],
    };
  }
  if (domainKey === "crm") {
    return {
      title: "CRM Revenue Console",
      introKicker: "Sales Workflow",
      introPurpose: "Track leads, customers, deals, and follow-ups with role-based operational control.",
      authTitle: "Revenue Workspace Login",
      authDescription: "Access your CRM workspace to manage the live pipeline and customer operations.",
      highlights: ["Lead funnel", "Deal tracking", "Customer lifecycle", "Team role permissions"],
    };
  }
  if (domainKey === "realestate") {
    return {
      title: "Real Estate Operations Suite",
      introKicker: "Property Workflow",
      introPurpose: "Manage properties, leases, tenants, maintenance, and payments from one operations dashboard.",
      authTitle: "Property Access",
      authDescription: "Sign in to continue with secure property and tenancy operations.",
      highlights: ["Property portfolio", "Lease lifecycle", "Maintenance tracking", "Tenant and payment operations"],
    };
  }
  if (domainKey === "ecommerce") {
    return {
      title: "Ecommerce Operations Console",
      introKicker: "Commerce Workflow",
      introPurpose: "Manage catalog, orders, fulfillment, and customer-facing operations in a unified control panel.",
      authTitle: "Commerce Access",
      authDescription: "Sign in to run daily catalog and order operations with secure account access.",
      highlights: ["Catalog control", "Order lifecycle", "Inventory visibility", "Delivery coordination"],
    };
  }
  return {
    title: "Operations Management Platform",
    introKicker: "Business Workflow",
    introPurpose: "Run secure, role-based operations from introduction to dashboard with real authenticated workflows.",
    authTitle: "Secure Access",
    authDescription: "Sign in to continue managing your live operational modules.",
    highlights: ["Module operations", "Role-based access", "Authenticated API flows", "Live record management"],
  };
}

function inferPromptAppFocus(userPrompt, plan, domainKey) {
  const text = String(userPrompt || "").replace(/\s+/g, " ").trim();
  const candidates = [];
  const patterns = [
    /\b(?:build|create|generate|develop)\b[^.:\n]{0,80}\b([a-z][a-z0-9/&\-\s]{2,50})\s+app\b/i,
    /\b([a-z][a-z0-9/&\-\s]{2,50})\s+app\b/i,
    /\bfor\s+([a-z][a-z0-9/&\-\s]{2,50})\s+(?:business|operations|workflow|platform)\b/i,
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    if (match && match[1]) candidates.push(String(match[1]));
  }
  if (typeof plan?.projectName === "string" && plan.projectName.trim()) {
    candidates.push(String(plan.projectName).replace(/[-_]+/g, " "));
  }
  candidates.push(String(domainKey || "operations"));

  const noise = /\b(fullstack|full stack|production|style|real time|runnable|web|flow|requirements?|stack|frontend|backend|database|mysql|mongodb|node|express|html|css|javascript|vanilla|prompt|exactly)\b/gi;
  for (const raw of candidates) {
    const cleaned = String(raw || "")
      .replace(noise, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 3) return cleaned;
  }
  return "Operations";
}

function buildPromptAwareShellCopy(domainKey, userPrompt, plan) {
  const base = getDomainShellCopy(domainKey);
  const focus = inferPromptAppFocus(userPrompt, plan, domainKey);
  const focusTitle = toTitleCase(focus);
  const domainLabel = toTitleCase(domainKey === ADAPTIVE_DOMAIN_KEY ? "operations" : domainKey);
  const titleSuffixPattern = /\b(app|platform|suite|console|hub)\b/i;
  const title = titleSuffixPattern.test(focusTitle)
    ? focusTitle
    : `${focusTitle} Platform`;

  return {
    ...base,
    title,
    introKicker: `${domainLabel} Workflow`,
    introPurpose: `This application is tailored for ${focusTitle} operations with secure authentication and role-based dashboard workflows.`,
    authTitle: `${focusTitle} Access`,
    authDescription: `Sign in to continue managing ${focusTitle.toLowerCase()} modules and live operational data.`,
  };
}

function inferAdaptiveStyleIntent(userPrompt, plan, modules = []) {
  const text = [
    String(userPrompt || ""),
    String(plan?.projectName || ""),
    Array.isArray(plan?.notes) ? plan.notes.join(" ") : "",
    Array.isArray(modules) ? modules.map((m) => String(m?.key || m?.label || "")).join(" ") : "",
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(minimal|clean|simple|light|airy|white)\b/.test(text)) return "minimal";
  if (/\b(enterprise|corporate|audit|compliance|finance|bank|b2b|admin)\b/.test(text)) return "enterprise";
  if (/\b(creative|studio|agency|brand|portfolio|media)\b/.test(text)) return "creative";
  if (/\b(logistics|fleet|dispatch|warehouse|supply|transport|manufactur|operations)\b/.test(text)) return "industrial";
  if (/\b(premium|luxury|elegant|high[- ]end|exclusive)\b/.test(text)) return "premium";
  if (/\b(eco|green|sustainab|agri|farm|organic)\b/.test(text)) return "eco";
  if (/\b(startup|modern|futur|innovative|bold|tech)\b/.test(text)) return "bold";
  return "balanced";
}

function buildAdaptiveStyleBlueprint(userPrompt, plan, modules = []) {
  const focusTitle = toTitleCase(inferPromptAppFocus(userPrompt, plan, ADAPTIVE_DOMAIN_KEY));
  const moduleSeed = (Array.isArray(modules) ? modules.map((m) => String(m?.key || m || "")).join(",") : "");
  const seed = [
    String(userPrompt || ""),
    String(plan?.projectName || ""),
    moduleSeed,
    focusTitle,
  ].join("|");
  const promptText = String(userPrompt || "").toLowerCase();
  const seedHash = hashString(seed);
  const intent = inferAdaptiveStyleIntent(userPrompt, plan, modules);

  const variantMap = {
    atlas: {
      key: "atlas",
      icon: "HQ",
      fontStack: "\"Sora\", \"Manrope\", \"Segoe UI\", Arial, sans-serif",
      shell: {
        primary: "#0f3d5e",
        accent: "#2f80ed",
        accent2: "#36cfc9",
        bgA: "rgba(47, 128, 237, 0.18)",
        bgB: "rgba(54, 207, 201, 0.16)",
        bgC: "rgba(15, 61, 94, 0.14)",
      },
      dashboard: {
        bg: "#f4f7fb",
        panel: "#ffffff",
        primary: "#0f3d5e",
        accent: "#2f80ed",
        text: "#0f172a",
        muted: "#516074",
        border: "#d6e0ec",
        headerBg: "#edf4ff",
        sidebarGradient: "linear-gradient(180deg, #0f3d5e, #1f6aa5)",
      },
    },
    forge: {
      key: "forge",
      icon: "OPS",
      fontStack: "\"Space Grotesk\", \"Manrope\", \"Segoe UI\", Arial, sans-serif",
      shell: {
        primary: "#7a2e0b",
        accent: "#d97706",
        accent2: "#b45309",
        bgA: "rgba(217, 119, 6, 0.18)",
        bgB: "rgba(122, 46, 11, 0.14)",
        bgC: "rgba(180, 83, 9, 0.16)",
      },
      dashboard: {
        bg: "#fffaf4",
        panel: "#ffffff",
        primary: "#7a2e0b",
        accent: "#d97706",
        text: "#2a1808",
        muted: "#6d4c2d",
        border: "#f1dcc4",
        headerBg: "#fff2e2",
        sidebarGradient: "linear-gradient(180deg, #7a2e0b, #b45309)",
      },
    },
    summit: {
      key: "summit",
      icon: "NXT",
      fontStack: "\"Plus Jakarta Sans\", \"Manrope\", \"Segoe UI\", Arial, sans-serif",
      shell: {
        primary: "#1f2937",
        accent: "#0ea5e9",
        accent2: "#10b981",
        bgA: "rgba(14, 165, 233, 0.16)",
        bgB: "rgba(16, 185, 129, 0.12)",
        bgC: "rgba(31, 41, 55, 0.13)",
      },
      dashboard: {
        bg: "#f4f8fb",
        panel: "#ffffff",
        primary: "#1f2937",
        accent: "#0ea5e9",
        text: "#111827",
        muted: "#4b5563",
        border: "#d7e3ef",
        headerBg: "#edf4fa",
        sidebarGradient: "linear-gradient(180deg, #1f2937, #334155)",
      },
    },
    horizon: {
      key: "horizon",
      icon: "CORE",
      fontStack: "\"Outfit\", \"Manrope\", \"Segoe UI\", Arial, sans-serif",
      shell: {
        primary: "#1d3557",
        accent: "#e76f51",
        accent2: "#2a9d8f",
        bgA: "rgba(231, 111, 81, 0.18)",
        bgB: "rgba(42, 157, 143, 0.14)",
        bgC: "rgba(29, 53, 87, 0.14)",
      },
      dashboard: {
        bg: "#f7f6f3",
        panel: "#ffffff",
        primary: "#1d3557",
        accent: "#e76f51",
        text: "#132031",
        muted: "#556274",
        border: "#e2ddd6",
        headerBg: "#f6efea",
        sidebarGradient: "linear-gradient(180deg, #1d3557, #2d4a72)",
      },
    },
    pulse: {
      key: "pulse",
      icon: "LAB",
      fontStack: "\"Urbanist\", \"Manrope\", \"Segoe UI\", Arial, sans-serif",
      shell: {
        primary: "#4c1d95",
        accent: "#7c3aed",
        accent2: "#ec4899",
        bgA: "rgba(124, 58, 237, 0.2)",
        bgB: "rgba(236, 72, 153, 0.16)",
        bgC: "rgba(76, 29, 149, 0.14)",
      },
      dashboard: {
        bg: "#f8f5ff",
        panel: "#ffffff",
        primary: "#4c1d95",
        accent: "#7c3aed",
        text: "#1f1140",
        muted: "#5f4b8a",
        border: "#e4dcf8",
        headerBg: "#f3ebff",
        sidebarGradient: "linear-gradient(180deg, #4c1d95, #6d28d9)",
      },
    },
  };

  const intentPools = {
    minimal: ["summit", "atlas"],
    enterprise: ["atlas", "summit"],
    creative: ["horizon", "pulse"],
    industrial: ["forge", "atlas"],
    premium: ["horizon", "pulse"],
    eco: ["summit", "atlas"],
    bold: ["pulse", "horizon"],
    balanced: ["atlas", "summit", "horizon", "forge", "pulse"],
  };
  const pool = intentPools[intent] || intentPools.balanced;
  const selectedKey = pool[seedHash % pool.length];
  const selected = { ...(variantMap[selectedKey] || variantMap.atlas) };

  const colorOverrides = [
    { rx: /\bblue\b/i, primary: "#1d4ed8", accent: "#0ea5e9", accent2: "#1e40af" },
    { rx: /\bgreen\b/i, primary: "#166534", accent: "#22c55e", accent2: "#0f766e" },
    { rx: /\borange\b/i, primary: "#9a3412", accent: "#f97316", accent2: "#ea580c" },
    { rx: /\bred\b/i, primary: "#991b1b", accent: "#dc2626", accent2: "#ef4444" },
    { rx: /\bteal\b/i, primary: "#0f766e", accent: "#14b8a6", accent2: "#0d9488" },
    { rx: /\bslate\b|\bgray\b|\bgrey\b/i, primary: "#1f2937", accent: "#334155", accent2: "#475569" },
  ];
  for (const item of colorOverrides) {
    if (!item.rx.test(promptText)) continue;
    selected.shell = {
      ...selected.shell,
      primary: item.primary,
      accent: item.accent,
      accent2: item.accent2,
    };
    selected.dashboard = {
      ...selected.dashboard,
      primary: item.primary,
      accent: item.accent,
    };
    break;
  }

  if (/\bserif\b/i.test(promptText)) {
    selected.fontStack = "\"Merriweather\", \"Georgia\", serif";
  } else if (/\bmono(?:space)?\b/i.test(promptText)) {
    selected.fontStack = "\"IBM Plex Mono\", \"Consolas\", monospace";
  }

  return {
    ...selected,
    focusTitle,
    subtitle: `${focusTitle} workflows with role-based operations and live module execution.`,
    metricLabels: ["Total Records", "Active Workflows", "Updated Today"],
    workspaceLabel: `${focusTitle} Command Workspace`,
  };
}

function getDomainLandingContent(domainKey, appTitle, highlights) {
  const fallbackHighlights = (Array.isArray(highlights) ? highlights : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const defaultHighlights = fallbackHighlights.length
    ? fallbackHighlights
    : ["Workflow automation", "Role-based controls", "Live dashboard modules"];

  if (domainKey === "fooddelivery") {
    return {
      insightTitle: "Zomato-Style Food Experience",
      insightLead: `${appTitle} combines restaurant discovery, menu browsing, cart checkout, and live delivery tracking in one consumer-ready flow.`,
      insights: [
        { title: "Restaurant Discovery", text: "Highlight top restaurants with rating, ETA, and cuisine tags." },
        { title: "Menu to Cart", text: "Add dishes with quantity controls, notes, and offer visibility." },
        { title: "Live Delivery", text: "Track each order from confirmation to doorstep delivery." },
      ],
      workflow: [
        { title: "Discover", text: "Search by dish, restaurant, cuisine, and location filters." },
        { title: "Order", text: "Add items, review cart, and place payment-backed checkout." },
        { title: "Track", text: "Follow preparation, pickup, and live delivery timeline updates." },
      ],
      metrics: ["Higher repeat orders", "Faster checkout completion", "Clear delivery visibility"],
      authPoints: ["Role-based food workflows", "Secure customer access", "Live order operations"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "healthcare") {
    return {
      insightTitle: "Clinical Operations, End-to-End",
      insightLead: `${appTitle} helps care teams coordinate patients, appointments, and prescriptions with clear role ownership.`,
      insights: [
        { title: "Care Coordination", text: "Unify front-desk scheduling and provider activities." },
        { title: "Record Visibility", text: "Track patient updates and prescriptions in one place." },
        { title: "Operational Control", text: "Keep clinic workflows secure and role-based." },
      ],
      workflow: [
        { title: "Onboard", text: "Register staff and patient accounts with access control." },
        { title: "Operate", text: "Manage daily appointments and care operations." },
        { title: "Review", text: "Monitor updates from a centralized dashboard." },
      ],
      metrics: ["Faster patient turnaround", "Reduced scheduling friction", "Better care traceability"],
      authPoints: ["Protected healthcare workflows", "Role-based dashboard access", "Live operational visibility"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "lms") {
    return {
      insightTitle: "Production LMS, From Catalog to Certificate",
      insightLead: `${appTitle} provides a full learning lifecycle with instructor publishing, student classrooms, grading, and certificate workflows.`,
      insights: [
        { title: "Course Marketplace", text: "Publish and manage course catalogs with level, pricing, and curriculum metadata." },
        { title: "Instruction Delivery", text: "Run lessons, assignments, quizzes, and progress checkpoints in one classroom." },
        { title: "Completion Outcomes", text: "Track grading, certificate eligibility, and learning analytics by role." },
      ],
      workflow: [
        { title: "Publish", text: "Admins and instructors launch structured courses and learning paths." },
        { title: "Learn", text: "Students enroll, complete modules, and submit assessments." },
        { title: "Certify", text: "Evaluate outcomes and issue certificates with audit-ready status." },
      ],
      metrics: ["Higher completion rates", "Instructor productivity", "Reliable certificate operations"],
      authPoints: ["Role-based LMS access", "Secure learning records", "Operational dashboard visibility"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "education") {
    return {
      insightTitle: "LMS Workflow That Feels Production-Ready",
      insightLead: `${appTitle} centralizes courses, cohorts, assignments, and learner progress for admins, instructors, and students.`,
      insights: [
        { title: "Course Delivery", text: "Manage curriculum modules, release schedules, and completion logic." },
        { title: "Instructor Workspace", text: "Coordinate faculty tasks, assignment review, and student support." },
        { title: "Learner Visibility", text: "Track progress, deadlines, and outcomes from one dashboard." },
      ],
      workflow: [
        { title: "Onboard", text: "Enroll learners and assign them to course tracks." },
        { title: "Deliver", text: "Run sessions, publish assignments, and manage feedback loops." },
        { title: "Measure", text: "Monitor completion, ratings, and engagement across cohorts." },
      ],
      metrics: ["Higher learner completion", "Cleaner instructor operations", "Centralized LMS visibility"],
      authPoints: ["Secure LMS access", "Role-based learning modules", "Unified course operations dashboard"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "fitness") {
    return {
      insightTitle: "Performance & Coaching Operations",
      insightLead: `${appTitle} supports member management, workouts, plans, and progress tracking with structured operational flows.`,
      insights: [
        { title: "Program Delivery", text: "Assign and manage plans for each member profile." },
        { title: "Progress Tracking", text: "Capture measurable updates over time." },
        { title: "Coach Control", text: "Operate sessions and follow-ups from one panel." },
      ],
      workflow: [
        { title: "Enroll", text: "Create member accounts and baseline details." },
        { title: "Train", text: "Run plans, sessions, and daily coaching tasks." },
        { title: "Improve", text: "Use dashboard data for better outcomes." },
      ],
      metrics: ["Higher member engagement", "Cleaner progress visibility", "Faster coaching workflows"],
      authPoints: ["Secure member access", "Role-specific controls", "Live training operations"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "crm") {
    return {
      insightTitle: "Revenue Workflow in One System",
      insightLead: `${appTitle} aligns leads, deals, and customer activities for predictable sales operations.`,
      insights: [
        { title: "Pipeline Visibility", text: "Track lead-to-deal movement across teams." },
        { title: "Account Operations", text: "Manage customer data and follow-ups." },
        { title: "Sales Execution", text: "Keep every role focused on next actions." },
      ],
      workflow: [
        { title: "Capture", text: "Register leads and qualification data." },
        { title: "Progress", text: "Move deals through measurable stages." },
        { title: "Close", text: "Review outcomes and optimize workflows." },
      ],
      metrics: ["Better conversion control", "Clear sales accountability", "Centralized customer view"],
      authPoints: ["Secure sales workspace", "Role-based pipeline modules", "Live operational tracking"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "realestate") {
    return {
      insightTitle: "Property Operations Command Layer",
      insightLead: `${appTitle} brings property, lease, maintenance, and tenancy workflows into one operational system.`,
      insights: [
        { title: "Portfolio Control", text: "Manage listings and occupancy with clear status visibility." },
        { title: "Lease Workflow", text: "Coordinate tenant lifecycle and contract operations." },
        { title: "Maintenance Tracking", text: "Monitor requests and resolution activities." },
      ],
      workflow: [
        { title: "List", text: "Create and organize property records." },
        { title: "Lease", text: "Operate tenancy and contract updates." },
        { title: "Maintain", text: "Track service requests and outcomes." },
      ],
      metrics: ["Centralized portfolio view", "Lower operational delays", "Better tenancy governance"],
      authPoints: ["Secure property access", "Role-aligned operations", "Consistent workflow tracking"],
      highlights: defaultHighlights,
    };
  }

  if (domainKey === "ecommerce") {
    return {
      insightTitle: "Commerce Operations, Professionally Managed",
      insightLead: `${appTitle} streamlines catalog, order, customer, and fulfillment workflows in one unified environment.`,
      insights: [
        { title: "Catalog Control", text: "Manage items, pricing, and availability quickly." },
        { title: "Order Lifecycle", text: "Track each order from creation to completion." },
        { title: "Delivery Coordination", text: "Keep dispatch and status updates transparent." },
      ],
      workflow: [
        { title: "Publish", text: "Create and update customer-facing catalog data." },
        { title: "Fulfill", text: "Process, assign, and track orders in real time." },
        { title: "Scale", text: "Use role-based dashboards for daily operations." },
      ],
      metrics: ["Cleaner order operations", "Faster fulfillment updates", "Better customer visibility"],
      authPoints: ["Secure commerce access", "Role-based module permissions", "Live data-backed workflows"],
      highlights: defaultHighlights,
    };
  }

  return {
    insightTitle: "Production App Foundation",
    insightLead: `${appTitle} provides a complete shell from introduction to login, registration, and role-based dashboard operations.`,
    insights: [
      { title: "Introduction Experience", text: "Present domain value clearly with structured sections and CTA flow." },
      { title: "Secure Authentication", text: "Use login and registration with role-aware access controls." },
      { title: "Operational Dashboard", text: "Run module workflows, CRUD actions, and data visibility in one workspace." },
    ],
    workflow: [
      { title: "Introduce", text: "Guide users through a professional landing page." },
      { title: "Authenticate", text: "Register and sign in with role-based identity." },
      { title: "Operate", text: "Manage live records through module-specific dashboards." },
    ],
    metrics: ["Full app shell ready", "Role-safe collaboration", "Reliable operational flow"],
    authPoints: ["Secure login system", "Role-based navigation", "Production-style layout"],
    highlights: defaultHighlights,
  };
}

function inferAdaptiveRoleOptions(userPrompt, plan) {
  const sourceText = [
    String(userPrompt || ""),
    Array.isArray(plan?.notes) ? plan.notes.join(" ") : "",
    Array.isArray(plan?.entities) ? plan.entities.join(" ") : "",
    Array.isArray(plan?.pages) ? plan.pages.join(" ") : "",
  ].join("\n");
  const text = sourceText.toLowerCase();
  const ordered = [];
  const pushRole = (value) => {
    const clean = normalizeRoleKey(String(value || "").trim().replace(/\s+/g, "_"));
    if (!clean || ordered.includes(clean)) return;
    ordered.push(clean);
  };

  const blocked = new Set([
    "role",
    "roles",
    "dashboard",
    "dashboards",
    "permissions",
    "access",
    "module",
    "modules",
    "landing",
    "login",
    "register",
    "crud",
    "jwt",
    "mysql",
    "responsive",
  ]);
  const pushChunk = (chunk) => {
    String(chunk || "")
      .split(/,|\/|\||;|\+|\band\b/gi)
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .forEach((token) => {
        const cleaned = normalizeRoleKey(token);
        if (!cleaned || blocked.has(cleaned)) return;
        if (cleaned.length < 2 || cleaned.length > 32) return;
        pushRole(cleaned);
      });
  };

  // Prefer explicit role declarations (e.g., "Roles: admin, dispatcher, driver")
  const explicitPatterns = [
    /(?:^|\n)\s*roles?\s*(?:and[^\n:]{0,40})?\s*[:=-]\s*([^\n]+)/gi,
    /(?:roles?\s+(?:include|are|as))\s*[:=-]?\s*([^\n.]+)/gi,
  ];
  for (const rx of explicitPatterns) {
    let match;
    while ((match = rx.exec(sourceText)) !== null) {
      pushChunk(match[1]);
    }
  }

  const lines = sourceText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;
    if (!/^\s*roles?\b/i.test(line)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j += 1) {
      const next = String(lines[j] || "").trim();
      if (!next) break;
      const bullet = next.match(/^\s*[-*]\s*([A-Za-z][A-Za-z0-9 _-]{1,40})\s*$/);
      if (!bullet) break;
      pushRole(bullet[1]);
    }
  }
  if (ordered.length) {
    return ordered.slice(0, 6).map((role) => ({ value: role, label: toTitleCase(role) }));
  }

  const hints = [
    "admin",
    "owner",
    "manager",
    "operator",
    "dispatcher",
    "driver",
    "coordinator",
    "supervisor",
    "staff",
    "agent",
    "customer",
    "client",
    "vendor",
    "employee",
    "analyst",
    "support",
    "member",
    "user",
  ];

  for (const role of hints) {
    const rx = new RegExp(`\\b${role.replace("_", "\\s*")}\\b`, "i");
    if (rx.test(text)) pushRole(role);
  }

  if (!ordered.includes("admin")) ordered.unshift("admin");
  if (!ordered.includes("manager")) ordered.push("manager");
  if (!ordered.includes("user")) ordered.push("user");

  return ordered.slice(0, 5).map((role) => ({ value: role, label: toTitleCase(role) }));
}

function extractRoleAccessHints(userPrompt, modules = []) {
  const text = String(userPrompt || "");
  if (!text.trim()) return { canWriteByRole: {} };
  const moduleKeys = uniqueList((Array.isArray(modules) ? modules : []).map((m) => String(m?.key || "").toLowerCase()).filter(Boolean));
  if (!moduleKeys.length) return { canWriteByRole: {} };

  const roleAlias = {
    users: "user",
    admins: "admin",
    managers: "manager",
    operators: "operator",
    dispatchers: "dispatcher",
    drivers: "driver",
    vendors: "vendor",
    clients: "client",
    customers: "customer",
    employees: "employee",
    analysts: "analyst",
    supervisors: "supervisor",
  };

  const toRoleKey = (raw) => {
    const normalized = normalizeRoleKey(raw);
    if (!normalized) return "";
    return roleAlias[normalized] || normalized;
  };

  const resolveModuleKeys = (rawChunk) => {
    const chunk = String(rawChunk || "").trim();
    if (!chunk) return [];
    if (/\b(all|everything|all modules?|all sections?)\b/i.test(chunk)) {
      return moduleKeys;
    }
    const tokens = chunk
      .split(/,|\/|\||;|\+|\band\b/gi)
      .map((item) => normalizeModuleLabel(item))
      .filter(Boolean);
    const resolved = [];
    for (const tokenLabel of tokens) {
      const tokenKey = safeModuleKey(tokenLabel);
      if (moduleKeys.includes(tokenKey)) {
        resolved.push(tokenKey);
        continue;
      }
      const lower = tokenLabel.toLowerCase();
      const fuzzy = (Array.isArray(modules) ? modules : []).find((mod) => {
        const mk = String(mod?.key || "").toLowerCase();
        const ml = String(mod?.label || "").toLowerCase();
        return mk === tokenKey || ml === lower || ml.includes(lower) || lower.includes(ml);
      });
      if (fuzzy?.key) resolved.push(String(fuzzy.key).toLowerCase());
    }
    return uniqueList(resolved);
  };

  const canWriteByRole = {};
  const addWrite = (roleRaw, moduleChunk) => {
    const role = toRoleKey(roleRaw);
    if (!role) return;
    const writeModules = resolveModuleKeys(moduleChunk);
    if (!writeModules.length) return;
    canWriteByRole[role] = uniqueList([...(canWriteByRole[role] || []), ...writeModules]);
  };

  const patterns = [
    /^\s*([a-z][a-z0-9_ -]{1,40})\s*(?:can|should|must)?\s*(?:write|edit|create|update|delete|submit|enter(?:\s+details)?)\s*(?:on|for|in)?\s*(?:modules?|sections?)?\s*[:=-]\s*(.+)$/i,
    /^\s*allow\s+([a-z][a-z0-9_ -]{1,40})\s+to\s+(?:write|edit|create|update|delete|submit|enter(?:\s+details)?)\s*(?:on|for|in)?\s*(?:modules?|sections?)?\s*[:=-]?\s*(.+)$/i,
    /^\s*([a-z][a-z0-9_ -]{1,40})\s*write(?:able)?\s*modules?\s*[:=-]\s*(.+)$/i,
  ];

  for (const line of text.split(/\r?\n/)) {
    const source = String(line || "").trim();
    if (!source) continue;
    for (const rx of patterns) {
      const match = source.match(rx);
      if (!match) continue;
      addWrite(match[1], match[2]);
      break;
    }
  }

  const inlinePattern = /allow\s+([a-z][a-z0-9_ -]{1,40})\s+to\s+(?:enter\s+details|write|edit|create|update|submit)\s+(?:in|on|for)\s+([^.]+)/gi;
  let inlineMatch;
  while ((inlineMatch = inlinePattern.exec(text)) !== null) {
    addWrite(inlineMatch[1], inlineMatch[2]);
  }

  return { canWriteByRole };
}

function buildDynamicShellPages(userPrompt, plan, frontendRoot = "frontend", styleSeed = "") {
  const domainKey = detectDomainTemplateKey(userPrompt, plan);
  const variant = pickShellStyleVariant(userPrompt, plan, styleSeed);
  const copy = buildPromptAwareShellCopy(domainKey, userPrompt, plan);
  const prefix = frontendRoot ? `${frontendRoot.replace(/\/+$/, "")}/` : "";
  const modules = inferDashboardModules(userPrompt, plan, domainKey)
    .map((item) => String(item?.label || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const highlights = modules.length ? modules : copy.highlights;
  const landing = getDomainLandingContent(domainKey, copy.title, highlights);
  const adaptiveBlueprint =
    domainKey === ADAPTIVE_DOMAIN_KEY ? buildAdaptiveStyleBlueprint(userPrompt, plan, modules) : null;
  const registerRoles =
    domainKey === "lms" || domainKey === "education"
      ? [
          { value: "student", label: "student" },
          { value: "instructor", label: "instructor" },
          { value: "admin", label: "admin" },
        ]
      : domainKey === "fooddelivery"
      ? [
          { value: "customer", label: "customer" },
          { value: "restaurant_owner", label: "restaurant_owner" },
          { value: "delivery_partner", label: "delivery_partner" },
          { value: "admin", label: "admin" },
        ]
      : domainKey === "healthcare"
      ? [
          { value: "patient", label: "patient" },
          { value: "doctor", label: "doctor" },
          { value: "receptionist", label: "receptionist" },
          { value: "pharmacist", label: "pharmacist" },
          { value: "lab_technician", label: "lab_technician" },
          { value: "admin", label: "admin" },
        ]
      : inferAdaptiveRoleOptions(userPrompt, plan);
  const registerRoleOptionsHtml = registerRoles
    .map((role) => `<option value="${escapeHtml(role.value)}">${escapeHtml(role.label)}</option>`)
    .join("");
  const adaptiveShell = adaptiveBlueprint?.shell || {
    primary: "#0f766e",
    accent: "#14b8a6",
    accent2: "#0f172a",
    bgA: "rgba(37, 99, 235, 0.2)",
    bgB: "rgba(124, 58, 237, 0.18)",
    bgC: "rgba(14, 165, 233, 0.16)",
  };
  const shellFontStack = adaptiveBlueprint?.fontStack || "\"Manrope\", \"Segoe UI\", Tahoma, Arial, sans-serif";

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(copy.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Urbanist:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="style.css" />
</head>
<body class="shell-page shell-${variant.key} domain-${domainKey}">
  <main class="site-shell">
    <header class="site-nav">
      <div class="logo">${escapeHtml(copy.title)}</div>
      <nav class="nav-links">
        <a href="#overview">Overview</a>
        <a href="#capabilities">Capabilities</a>
        <a href="#workflow">Workflow</a>
      </nav>
      <div class="nav-cta">
        <a class="btn ghost" href="login.html">Login</a>
        <a class="btn secondary" href="register.html">Register</a>
      </div>
    </header>

    <section class="hero-grid" id="overview">
      <article class="hero-copy">
        <p class="kicker">${escapeHtml(copy.introKicker)}</p>
        <h1>${escapeHtml(copy.title)}</h1>
        <p class="lead">${escapeHtml(copy.introPurpose)}</p>
        <div class="hero-actions">
          <a class="btn" href="register.html">Create Account</a>
          <a class="btn secondary" href="login.html">Sign In</a>
        </div>
        <div class="badge-row">
          <span class="badge">Secure Auth</span>
          <span class="badge">Role-based Modules</span>
          <span class="badge">Live Data Flow</span>
        </div>
        <div class="hero-metric-grid">
          ${landing.metrics.slice(0, 3).map((m, idx) => `<article class="hero-metric"><h3>${idx + 1}</h3><p>${escapeHtml(m)}</p></article>`).join("")}
        </div>
      </article>
      <aside class="hero-panel">
        <div class="preview-card">
          <h2>${escapeHtml(landing.insightTitle)}</h2>
          <p>${escapeHtml(landing.insightLead)}</p>
          <div class="preview-kpi">
            ${landing.highlights.slice(0, 3).map((item) => `<div class="preview-kpi-item"><span>${escapeHtml(item)}</span><strong>Active</strong></div>`).join("")}
          </div>
          <ul class="insight-list">
            ${landing.insights.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></li>`).join("")}
          </ul>
        </div>
      </aside>
    </section>

    <section class="trust-strip" aria-label="Operational strengths">
      ${landing.metrics.slice(0, 4).map((m) => `<span>${escapeHtml(m)}</span>`).join("")}
    </section>

    <section class="capability-grid" id="capabilities">
      ${landing.highlights.map((item) => `<article class="capability-card"><h3>${escapeHtml(item)}</h3><p>Operational capability configured for this application domain.</p></article>`).join("")}
    </section>

    <section class="workflow-card" id="workflow">
      <h2>Execution Workflow</h2>
      <ol class="workflow-steps">
        ${landing.workflow.map((step) => `<li><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.text)}</span></li>`).join("")}
      </ol>
      <div class="metric-pills">
        ${landing.metrics.map((m) => `<span>${escapeHtml(m)}</span>`).join("")}
      </div>
    </section>

    <section class="proof-grid">
      ${landing.insights.map((item) => `<article class="proof-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p></article>`).join("")}
    </section>

    <section class="cta-band">
      <h2>Start Building with ${escapeHtml(copy.title)}</h2>
      <p>Onboard users securely and manage domain workflows from a production-style dashboard.</p>
      <div class="hero-actions">
        <a class="btn" href="register.html">Get Started</a>
        <a class="btn ghost" href="login.html">Existing Account</a>
      </div>
    </section>
    <footer class="shell-footer">
      <span>${escapeHtml(copy.title)}</span>
      <span>Professional multi-role application template</span>
    </footer>
  </main>
  <script src="script.js"></script>
</body>
</html>`;

  const loginHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login | ${escapeHtml(copy.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Urbanist:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="style.css" />
</head>
<body class="shell-page shell-${variant.key} domain-${domainKey}">
  <main class="auth-wrap">
    <section class="auth-frame">
      <aside class="auth-side">
        <p class="kicker">${escapeHtml(copy.introKicker)}</p>
        <h1>${escapeHtml(copy.authTitle)}</h1>
        <p>${escapeHtml(copy.authDescription)}</p>
        <ul class="auth-points">
          ${landing.authPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
        </ul>
      </aside>
      <section class="auth-card">
        <h2>Sign In</h2>
        <p class="auth-subtitle">Continue to your operational workspace.</p>
        <form id="loginForm" class="auth-form">
          <label>Email</label>
          <input name="email" type="email" required />
          <label>Password</label>
          <input name="password" type="password" required />
          <button type="submit">Login</button>
        </form>
        <p class="auth-links"><a href="register.html">Create account</a> <span>|</span> <a href="index.html">Back Home</a></p>
      </section>
    </section>
  </main>
  <script src="script.js"></script>
  <script src="login.js"></script>
</body>
</html>`;

  const registerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Register | ${escapeHtml(copy.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Urbanist:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="style.css" />
</head>
<body class="shell-page shell-${variant.key} domain-${domainKey}">
  <main class="auth-wrap">
    <section class="auth-frame">
      <aside class="auth-side">
        <p class="kicker">Onboarding</p>
        <h1>Create your access profile</h1>
        <p>Register once to activate role-based modules and secure dashboard access.</p>
        <ul class="auth-points">
          ${landing.authPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
        </ul>
      </aside>
      <section class="auth-card">
        <h2>Create Account</h2>
        <p class="auth-subtitle">Set up your identity for operational workflows.</p>
        <form id="registerForm" class="auth-form">
          <label>Full Name</label>
          <input name="name" required />
          <label>Email</label>
          <input name="email" type="email" required />
          <label>Phone</label>
          <input name="phone" type="tel" />
          <label>Password</label>
          <input name="password" type="password" required />
          <label>Role</label>
          <select name="role">
            ${registerRoleOptionsHtml}
          </select>
          <button type="submit">Register</button>
        </form>
        <p class="auth-links"><a href="login.html">Already have an account?</a> <span>|</span> <a href="index.html">Back Home</a></p>
      </section>
    </section>
  </main>
  <script src="script.js"></script>
  <script src="register.js"></script>
</body>
</html>`;

  const shellCss = `:root {
  --bg: #f4f7ff;
  --surface: #ffffff;
  --surface-soft: #f8fbff;
  --text: #0f172a;
  --muted: #475569;
  --primary: #2563eb;
  --accent: #0ea5e9;
  --accent-2: #7c3aed;
  --line: #d7dfeb;
  --ring: rgba(37, 99, 235, 0.2);
  --radius: 16px;
  --shadow: 0 18px 38px rgba(15, 23, 42, 0.14);
}

* { box-sizing: border-box; }
body.shell-page {
  margin: 0;
  min-height: 100vh;
  font-family: ${shellFontStack};
  color: var(--text);
  background:
    radial-gradient(circle at 8% 12%, rgba(37, 99, 235, 0.20), transparent 36%),
    radial-gradient(circle at 88% 14%, rgba(124, 58, 237, 0.18), transparent 34%),
    radial-gradient(circle at 84% 88%, rgba(14, 165, 233, 0.16), transparent 40%),
    linear-gradient(180deg, #f9fbff 0%, #f3f7ff 52%, #edf4ff 100%),
    var(--bg);
}

.shell-aurora { --primary: #4f46e5; --accent: #06b6d4; --accent-2: #7c3aed; }
.shell-linen { --primary: #9a3412; --accent: #ea580c; --accent-2: #d97706; }
.shell-graphite { --primary: #0f172a; --accent: #0891b2; --accent-2: #334155; --text: #020617; }
.shell-mint { --primary: #0f766e; --accent: #14b8a6; --accent-2: #0ea5a4; }

.domain-fooddelivery { --primary: #e23744; --accent: #ff6b6b; --accent-2: #ff8c42; }
.domain-healthcare { --primary: #1d4ed8; --accent: #0ea5e9; --accent-2: #2563eb; }
.domain-fitness { --primary: #15803d; --accent: #22c55e; --accent-2: #16a34a; }
.domain-education { --primary: #4338ca; --accent: #6366f1; --accent-2: #7c3aed; }
.domain-crm { --primary: #0f766e; --accent: #14b8a6; --accent-2: #0d9488; }
.domain-realestate { --primary: #0f172a; --accent: #0ea5e9; --accent-2: #334155; }
.domain-ecommerce { --primary: #b45309; --accent: #f97316; --accent-2: #ea580c; }
.domain-adaptive { --primary: ${adaptiveShell.primary}; --accent: ${adaptiveShell.accent}; --accent-2: ${adaptiveShell.accent2}; }
.domain-adaptive.shell-page {
  background:
    radial-gradient(circle at 8% 12%, ${adaptiveShell.bgA}, transparent 36%),
    radial-gradient(circle at 88% 14%, ${adaptiveShell.bgB}, transparent 34%),
    radial-gradient(circle at 84% 88%, ${adaptiveShell.bgC}, transparent 40%),
    linear-gradient(180deg, #f9fbff 0%, #f3f7ff 52%, #edf4ff 100%),
    var(--bg);
}

.site-shell {
  width: min(1160px, 94%);
  margin: 28px auto 34px;
  display: grid;
  gap: 16px;
}
.site-nav {
  background: linear-gradient(130deg, rgba(255,255,255,0.94), rgba(255,255,255,0.78));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.logo {
  font-weight: 800;
  font-size: 1.02rem;
  color: var(--primary);
}
.nav-links { display: inline-flex; gap: 12px; flex-wrap: wrap; }
.nav-links a { text-decoration: none; color: var(--text); font-weight: 600; font-size: 0.92rem; }
.nav-links a:hover { color: var(--primary); }

.hero-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 14px;
}
.hero-copy, .hero-panel, .workflow-card, .capability-card, .cta-band, .auth-card, .auth-side {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.hero-copy, .hero-panel, .workflow-card, .cta-band, .auth-card, .auth-side { padding: clamp(18px, 3vw, 30px); }

.kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--primary);
  font-weight: 700;
}
h1 {
  margin: 8px 0 0;
  font-size: clamp(32px, 4.5vw, 48px);
  line-height: 1.06;
}
.lead { margin: 12px 0 0; color: var(--muted); max-width: 60ch; }

.hero-actions {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.btn, button {
  border: 0;
  border-radius: 11px;
  padding: 10px 14px;
  text-decoration: none;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn, button[type="submit"] { background: var(--primary); color: #fff; }
.btn, button[type="submit"] {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
}
.btn.secondary {
  background: linear-gradient(135deg, #0f172a, #334155);
  color: #fff;
}
.btn.ghost {
  background: rgba(255,255,255,0.7);
  color: var(--primary);
  border: 1px solid var(--primary);
}

.badge-row {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.badge {
  border: 1px solid #d3deef;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 0.82rem;
  background: linear-gradient(130deg, rgba(255,255,255,0.96), rgba(239,246,255,0.98));
  color: #0f172a;
}

.hero-panel h2 { margin: 0 0 8px; font-size: 1.08rem; }
.hero-panel p { margin: 0 0 10px; color: var(--muted); }
.insight-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 9px;
}
.insight-list li {
  border: 1px solid #d3deef;
  border-radius: 12px;
  padding: 10px;
  background: linear-gradient(130deg, rgba(255,255,255,0.95), rgba(239,246,255,0.9));
  display: grid;
  gap: 4px;
}
.insight-list strong { color: var(--primary); font-size: 0.92rem; }
.insight-list span { color: var(--muted); font-size: 0.84rem; }

.capability-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(180px, 1fr));
  gap: 12px;
}
.capability-card {
  padding: 14px;
  background: linear-gradient(150deg, rgba(255,255,255,0.95), rgba(248,251,255,0.98));
  position: relative;
  overflow: hidden;
}
.capability-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  background: linear-gradient(180deg, var(--primary), var(--accent));
}
.capability-card:nth-child(2n)::before {
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
}
.capability-card:nth-child(3n)::before {
  background: linear-gradient(180deg, var(--accent-2), var(--primary));
}
.capability-card h3 { margin: 0 0 6px; font-size: 0.95rem; color: var(--primary); }
.capability-card p { margin: 0; color: var(--muted); font-size: 0.86rem; }

.workflow-card {
  background: linear-gradient(150deg, rgba(255,255,255,0.98), rgba(246,249,255,0.96));
}
.workflow-card h2 { margin: 0 0 10px; font-size: 1.08rem; }
.workflow-steps {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}
.workflow-steps li { display: grid; gap: 4px; }
.workflow-steps strong { font-size: 0.92rem; }
.workflow-steps span { color: var(--muted); font-size: 0.86rem; }
.metric-pills {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.metric-pills span {
  border-radius: 999px;
  border: 1px solid #d3deef;
  background: linear-gradient(130deg, rgba(255,255,255,0.96), rgba(239,246,255,0.95));
  padding: 6px 10px;
  font-size: 0.82rem;
}

.cta-band {
  background: linear-gradient(130deg, rgba(37,99,235,0.10), rgba(124,58,237,0.08), rgba(14,165,233,0.10));
  border-color: rgba(37,99,235,0.26);
}
.cta-band h2 { margin: 0; font-size: clamp(24px, 3vw, 34px); }
.cta-band p { margin: 8px 0 0; color: var(--muted); max-width: 64ch; }

.auth-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 20px;
}
.auth-frame {
  width: min(1040px, 100%);
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 14px;
}
.auth-side {
  background: linear-gradient(155deg, var(--primary), var(--accent));
  border-color: transparent;
  color: #dbeafe;
}
.auth-side h1 { margin: 8px 0 0; color: #fff; font-size: clamp(26px, 4vw, 40px); }
.auth-side p { color: #dbeafe; margin: 8px 0 0; }
.auth-points {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.auth-points li {
  background: rgba(255,255,255,0.14);
  border: 1px solid rgba(255,255,255,0.28);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.84rem;
}
.auth-card h2 { margin: 0; font-size: 1.7rem; }
.auth-subtitle { margin: 8px 0 14px; color: var(--muted); }
.auth-form { display: grid; gap: 8px; }
label { font-weight: 700; margin-top: 2px; }
input, select {
  width: 100%;
  padding: 10px 11px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  font-size: 0.95rem;
  outline: none;
}
input:focus, select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
.auth-links {
  margin: 14px 0 0;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--muted);
}
.auth-links a { color: var(--primary); text-decoration: none; font-weight: 700; }

.site-nav, .hero-copy, .hero-panel, .capability-card, .workflow-card, .cta-band, .auth-card {
  backdrop-filter: saturate(120%);
}

@media (max-width: 980px) {
  .hero-grid { grid-template-columns: 1fr; }
  .capability-grid { grid-template-columns: 1fr; }
  .auth-frame { grid-template-columns: 1fr; }
}

@media (max-width: 720px) {
  .site-nav {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Modern shell overhaul */
.site-shell {
  width: min(1240px, 95%);
  gap: 20px;
}
.site-nav {
  position: sticky;
  top: 14px;
  z-index: 20;
  padding: 14px 16px;
  border-radius: 18px;
  background: linear-gradient(120deg, rgba(10, 20, 34, 0.86), rgba(15, 29, 49, 0.78));
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 18px 44px rgba(2, 12, 27, 0.34);
  backdrop-filter: blur(16px) saturate(135%);
}
.logo { color: #f8fbff; font-size: 1.18rem; letter-spacing: 0.2px; }
.nav-links a { color: rgba(239, 246, 255, 0.9); font-weight: 600; }
.nav-links a:hover { color: #ffffff; }
.nav-cta { display: inline-flex; gap: 10px; align-items: center; }
.trust-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.trust-strip span {
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  padding: 8px 12px;
  font-size: 0.84rem;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  color: var(--text);
}

.hero-grid {
  grid-template-columns: 1.1fr 0.9fr;
  gap: 18px;
}
.hero-copy, .hero-panel {
  border-radius: 20px;
  border-color: rgba(255, 255, 255, 0.56);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(245, 249, 255, 0.9));
  box-shadow: 0 28px 56px rgba(10, 20, 34, 0.16);
}
.hero-copy h1 {
  font-size: clamp(36px, 4.8vw, 56px);
  line-height: 1.02;
  max-width: 12ch;
}
.lead { font-size: 1.05rem; line-height: 1.6; max-width: 62ch; }
.hero-actions .btn {
  border-radius: 12px;
  padding: 12px 18px;
  letter-spacing: 0.2px;
}
.hero-metric-grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
}
.hero-metric {
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: rgba(255, 255, 255, 0.82);
}
.hero-metric h3 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--primary);
}
.hero-metric p {
  margin: 6px 0 0;
  font-size: 0.82rem;
  color: var(--muted);
}
.preview-card {
  display: grid;
  gap: 12px;
}
.preview-kpi {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.preview-kpi-item {
  border-radius: 12px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(255, 255, 255, 0.82);
  display: grid;
  gap: 4px;
}
.preview-kpi-item span { font-size: 0.76rem; color: var(--muted); }
.preview-kpi-item strong { font-size: 0.9rem; color: var(--primary); }

.capability-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.capability-card {
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.1);
  transition: transform 0.24s ease, box-shadow 0.24s ease;
}
.capability-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 22px 34px rgba(15, 23, 42, 0.14);
}
.workflow-card,
.cta-band {
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.3);
}
.proof-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.proof-card {
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}
.proof-card h3 { margin: 0 0 6px; font-size: 1rem; color: var(--primary); }
.proof-card p { margin: 0; color: var(--muted); font-size: 0.9rem; line-height: 1.55; }
.shell-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--muted);
  font-size: 0.9rem;
}
.shell-footer span:first-child {
  color: var(--primary);
  font-weight: 700;
}
.auth-frame { gap: 18px; }
.auth-side,
.auth-card {
  border-radius: 20px;
  box-shadow: 0 24px 46px rgba(15, 23, 42, 0.18);
}
.auth-form input,
.auth-form select {
  border-radius: 12px;
  padding: 12px;
}
.auth-form button[type="submit"] {
  margin-top: 6px;
  border-radius: 12px;
  padding: 12px;
}

@media (max-width: 1100px) {
  .capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .proof-grid { grid-template-columns: 1fr; }
}
@media (max-width: 980px) {
  .hero-grid { grid-template-columns: 1fr; }
  .hero-copy h1 { max-width: none; }
}
@media (max-width: 760px) {
  .nav-cta { width: 100%; justify-content: flex-start; }
  .hero-metric-grid,
  .preview-kpi { grid-template-columns: 1fr; }
  .capability-grid { grid-template-columns: 1fr; }
  .trust-strip { gap: 8px; }
  .shell-footer { flex-direction: column; align-items: flex-start; }
}
`;

  const shellScript = `(function () {
  const apiBase =
    localStorage.getItem("API_BASE_URL") ||
    (typeof location !== "undefined" && location.protocol === "file:"
      ? "http://localhost:5000/api"
      : ((location.origin || "") + "/api"));
  window.APP_API_BASE = String(apiBase || "/api").replace(/\\/+$/, "");
})();`;

  const loginScript = `(async function(){
  const form = document.getElementById("loginForm");
  if(!form) return;
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\\/+$/, "");

  async function requestJson(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_err) {
        data = { message: raw || "Invalid server response" };
      }
      return { res, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const { res, data } = await requestJson(API_BASE + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return alert(data.message || "Login failed");
      localStorage.setItem("token", data.token || "");
      localStorage.setItem("user", JSON.stringify(data.user || {}));
      location.href = "dashboard.html";
    } catch (err) {
      const isAbort = err && err.name === "AbortError";
      const msg = isAbort
        ? ("API request timed out. Check backend at " + API_BASE)
        : ("Cannot reach backend API at " + API_BASE + ". Start backend server and try again.");
      alert(msg);
    }
  });
})();`;

  const registerScript = `(async function(){
  const form = document.getElementById("registerForm");
  if(!form) return;
  const API_BASE = String(
    window.APP_API_BASE ||
      ((typeof location !== "undefined" && location.origin) ? (location.origin + "/api") : "/api")
  ).replace(/\\/+$/, "");

  async function requestJson(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_err) {
        data = { message: raw || "Invalid server response" };
      }
      return { res, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const { res, data } = await requestJson(API_BASE + "/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return alert(data.message || "Registration failed");
      alert("Registered successfully. Please login.");
      location.href = "login.html";
    } catch (err) {
      const isAbort = err && err.name === "AbortError";
      const msg = isAbort
        ? ("API request timed out. Check backend at " + API_BASE)
        : ("Cannot reach backend API at " + API_BASE + ". Start backend server and try again.");
      alert(msg);
    }
  });
})();`;

  return [
    { path: `${prefix}index.html`, content: indexHtml },
    { path: `${prefix}login.html`, content: loginHtml },
    { path: `${prefix}register.html`, content: registerHtml },
    { path: `${prefix}style.css`, content: shellCss },
    { path: `${prefix}script.js`, content: shellScript },
    { path: `${prefix}login.js`, content: loginScript },
    { path: `${prefix}register.js`, content: registerScript },
  ];
}

function uniqueList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function byModulePattern(moduleKeys, regex) {
  return uniqueList((moduleKeys || []).filter((k) => regex.test(String(k || "").toLowerCase())));
}

function getDomainRolePolicy(domainKey, modules, requestedRoles = [], accessHints = {}) {
  const moduleKeys = (modules || []).map((m) => String(m?.key || "").toLowerCase()).filter(Boolean);
  const all = uniqueList(moduleKeys);
  const requested = uniqueList(
    (Array.isArray(requestedRoles) ? requestedRoles : [])
      .map((role) => normalizeRoleKey(role))
      .filter(Boolean)
  );
  const defaultPolicy = {
    admin: { canView: all, canWrite: all },
    manager: { canView: all, canWrite: all.slice(0, Math.max(1, all.length - 1)) },
    user: { canView: all, canWrite: [] },
  };

  const ensureBroadcastView = (policy) => {
    const next = { ...(policy || {}) };
    for (const roleKey of Object.keys(next)) {
      if (String(roleKey).toLowerCase() === "admin") continue;
      const current = next[roleKey] || { canView: [], canWrite: [] };
      next[roleKey] = {
        ...current,
        // Mandatory rule: admin-added/admin-updated records must be visible to all users.
        // Keeping full module visibility avoids hiding those records behind sidebar restrictions.
        canView: all,
      };
    }
    return next;
  };

  if (domainKey === ADAPTIVE_DOMAIN_KEY && requested.length) {
    const adaptivePolicy = {};
    for (const roleKey of requested) {
      let canWrite = [];
      if (/(admin|owner|super_admin|supervisor)/i.test(roleKey)) {
        canWrite = all;
      } else if (/(manager|operator|dispatcher|coordinator)/i.test(roleKey)) {
        canWrite = all.slice(0, Math.max(1, all.length - 1));
      } else if (/driver/i.test(roleKey)) {
        const driverModules = byModulePattern(all, /trip|route|dispatch|delivery|vehicle|fuel|maintenance|log/);
        canWrite = driverModules.length ? driverModules : all.slice(0, 1);
      } else if (/(agent|staff|employee|analyst|support|technician|vendor|partner)/i.test(roleKey)) {
        canWrite = all.slice(0, Math.max(1, Math.ceil(all.length / 2)));
      } else {
        canWrite = [];
      }
      adaptivePolicy[roleKey] = {
        canView: all,
        canWrite: uniqueList(canWrite),
      };
    }
    if (!Object.keys(adaptivePolicy).some((roleKey) => /(admin|owner|manager|supervisor)/i.test(roleKey))) {
      const firstRole = Object.keys(adaptivePolicy)[0];
      if (firstRole) {
        adaptivePolicy[firstRole] = {
          canView: all,
          canWrite: all,
        };
      }
    }
    if (!adaptivePolicy.user) {
      adaptivePolicy.user = { canView: all, canWrite: [] };
    }
    const hintedWrites = accessHints?.canWriteByRole && typeof accessHints.canWriteByRole === "object"
      ? accessHints.canWriteByRole
      : {};
    for (const [rawRole, hintedModules] of Object.entries(hintedWrites)) {
      const roleKey = normalizeRoleKey(rawRole);
      if (!roleKey) continue;
      const allowed = uniqueList(
        (Array.isArray(hintedModules) ? hintedModules : [])
          .map((item) => String(item || "").toLowerCase())
          .filter((key) => all.includes(key))
      );
      if (!allowed.length) continue;
      const existing = adaptivePolicy[roleKey] || { canView: all, canWrite: [] };
      adaptivePolicy[roleKey] = {
        canView: all,
        canWrite: allowed,
      };
      if (!adaptivePolicy.user && roleKey === "user") {
        adaptivePolicy.user = existing;
      }
    }
    return ensureBroadcastView(adaptivePolicy);
  }

  if (domainKey === "lms") {
    const courses = byModulePattern(all, /course|catalog|curriculum|module|lecture|lesson/);
    const enrollments = byModulePattern(all, /enroll|registration/);
    const assignments = byModulePattern(all, /assignment|submission|grade/);
    const quizzes = byModulePattern(all, /quiz|exam|question/);
    const certificates = byModulePattern(all, /certificate/);
    const payments = byModulePattern(all, /payment|transaction|coupon|revenue/);
    const reviews = byModulePattern(all, /review|rating|feedback/);
    const studentView = uniqueList([...courses, ...enrollments, ...assignments, ...quizzes, ...certificates, ...reviews]);
    const instructorView = uniqueList([...studentView, ...payments]);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      instructor: { canView: instructorView.length ? instructorView : all, canWrite: uniqueList([...courses, ...assignments, ...quizzes, ...certificates, ...reviews]) },
      student: { canView: studentView.length ? studentView : courses, canWrite: uniqueList([...enrollments, ...assignments, ...quizzes, ...reviews]) },
      user: { canView: studentView.length ? studentView : courses, canWrite: uniqueList([...enrollments, ...assignments, ...quizzes, ...reviews]) },
    });
  }

  if (domainKey === "education") {
    const students = byModulePattern(all, /student/);
    const courses = byModulePattern(all, /course|class/);
    const teachers = byModulePattern(all, /teacher|faculty/);
    const enrollments = byModulePattern(all, /enroll|registration/);
    const teacherView = uniqueList([...students, ...courses, ...enrollments]);
    const studentView = uniqueList([...courses, ...enrollments]);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      teacher: { canView: teacherView.length ? teacherView : all, canWrite: enrollments.length ? enrollments : courses },
      student: { canView: studentView.length ? studentView : courses, canWrite: enrollments },
      user: { canView: studentView.length ? studentView : courses, canWrite: enrollments },
    });
  }

  if (domainKey === "fooddelivery") {
    const restaurants = byModulePattern(all, /restaurant|outlet|partner/);
    const menu = byModulePattern(all, /menu|food|dish|item/);
    const orders = byModulePattern(all, /order|cart|checkout/);
    const deliveries = byModulePattern(all, /deliver|dispatch|tracking|rider|partner/);
    const reviews = byModulePattern(all, /review|rating|feedback/);
    const customerView = uniqueList([...restaurants, ...menu, ...orders, ...deliveries, ...reviews]);
    const ownerView = uniqueList([...restaurants, ...menu, ...orders, ...reviews]);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      restaurant_owner: { canView: ownerView.length ? ownerView : all, canWrite: uniqueList([...restaurants, ...menu, ...orders]) },
      delivery_partner: { canView: uniqueList([...orders, ...deliveries]), canWrite: uniqueList([...deliveries, ...orders]) },
      customer: { canView: customerView.length ? customerView : all, canWrite: uniqueList([...orders, ...reviews]) },
      user: { canView: customerView.length ? customerView : all, canWrite: uniqueList([...orders, ...reviews]) },
    });
  }

  if (domainKey === "ecommerce") {
    const products = byModulePattern(all, /food|menu|product|catalog|inventory/);
    const orders = byModulePattern(all, /order/);
    const deliveries = byModulePattern(all, /deliver|shipment|rider/);
    const customerView = uniqueList([...products, ...orders]);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      manager: { canView: all, canWrite: uniqueList([...products, ...orders, ...deliveries]) },
      delivery: { canView: uniqueList([...deliveries, ...orders]), canWrite: deliveries },
      customer: { canView: customerView.length ? customerView : all, canWrite: orders },
      user: { canView: customerView.length ? customerView : all, canWrite: orders },
    });
  }

  if (domainKey === "healthcare") {
    const patients = byModulePattern(all, /patient/);
    const doctors = byModulePattern(all, /doctor/);
    const appointments = byModulePattern(all, /appointment|booking|schedule/);
    const prescriptions = byModulePattern(all, /prescription|medicine|pharmacy/);
    const lab = byModulePattern(all, /lab|test|report/);
    const billing = byModulePattern(all, /billing|payment|invoice/);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      doctor: { canView: uniqueList([...patients, ...appointments, ...prescriptions, ...lab]), canWrite: uniqueList([...appointments, ...prescriptions, ...lab]) },
      receptionist: { canView: uniqueList([...patients, ...doctors, ...appointments]), canWrite: uniqueList([...patients, ...appointments]) },
      pharmacist: { canView: uniqueList([...patients, ...prescriptions, ...billing]), canWrite: uniqueList([...prescriptions, ...billing]) },
      lab_technician: { canView: uniqueList([...patients, ...appointments, ...lab]), canWrite: uniqueList([...lab]) },
      patient: { canView: uniqueList([...appointments, ...prescriptions, ...lab, ...billing]), canWrite: appointments },
      user: { canView: uniqueList([...appointments, ...prescriptions, ...lab, ...billing]), canWrite: appointments },
    });
  }

  if (domainKey === "fitness") {
    const members = byModulePattern(all, /member|client|user/);
    const workouts = byModulePattern(all, /workout|exercise|session/);
    const plans = byModulePattern(all, /plan|diet|program/);
    const progress = byModulePattern(all, /progress|tracking|result/);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      trainer: { canView: uniqueList([...members, ...workouts, ...plans, ...progress]), canWrite: uniqueList([...workouts, ...plans, ...progress]) },
      member: { canView: uniqueList([...plans, ...workouts, ...progress]), canWrite: progress },
      user: { canView: uniqueList([...plans, ...workouts, ...progress]), canWrite: progress },
    });
  }

  if (domainKey === "crm") {
    const leads = byModulePattern(all, /lead|prospect/);
    const customers = byModulePattern(all, /customer|account/);
    const deals = byModulePattern(all, /deal|opportunit/);
    const activities = byModulePattern(all, /activit|task|follow/);
    const salesView = uniqueList([...leads, ...customers, ...deals, ...activities]);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      manager: { canView: all, canWrite: all },
      sales: { canView: salesView.length ? salesView : all, canWrite: uniqueList([...leads, ...deals, ...activities]) },
      user: { canView: salesView.length ? salesView : all, canWrite: uniqueList([...leads, ...activities]) },
    });
  }

  if (domainKey === "realestate") {
    const properties = byModulePattern(all, /propert|listing/);
    const tenants = byModulePattern(all, /tenant/);
    const leases = byModulePattern(all, /lease/);
    const maintenance = byModulePattern(all, /maintenance|issue|request/);
    const payments = byModulePattern(all, /payment|rent|invoice/);
    const agentView = uniqueList([...properties, ...tenants, ...leases, ...maintenance, ...payments]);
    const tenantView = uniqueList([...properties, ...leases, ...maintenance, ...payments]);
    return ensureBroadcastView({
      admin: { canView: all, canWrite: all },
      agent: { canView: agentView.length ? agentView : all, canWrite: uniqueList([...properties, ...leases, ...maintenance]) },
      tenant: { canView: tenantView.length ? tenantView : all, canWrite: uniqueList([...maintenance, ...payments]) },
      user: { canView: tenantView.length ? tenantView : all, canWrite: uniqueList([...maintenance, ...payments]) },
    });
  }

  return ensureBroadcastView(defaultPolicy);
}

function getDomainRoleAliases(domainKey) {
  if (domainKey === "fooddelivery") return { user: "customer" };
  if (domainKey === "lms") return { user: "student" };
  if (domainKey === "education") return { user: "student" };
  if (domainKey === "ecommerce") return { user: "customer" };
  if (domainKey === "healthcare") return { user: "patient" };
  if (domainKey === "fitness") return { user: "member" };
  if (domainKey === "crm") return { user: "sales" };
  if (domainKey === "realestate") return { user: "tenant" };
  return {};
}

function buildDomainContentLayout(profile, layoutProfile, visualProfile) {
  const statsBlock = `<section class="stats-grid">
          <article class="stat-card"><h3>${profile.metricLabels[0]}</h3><p id="metricTotal">0</p></article>
          <article class="stat-card"><h3>${profile.metricLabels[1]}</h3><p id="metricActive">0</p></article>
          <article class="stat-card"><h3>${profile.metricLabels[2]}</h3><p id="metricUpdated">0</p></article>
        </section>`;

  const moduleControlBlock = `<section class="panel module-head-panel">
          <div class="panel-head">
            <h2 id="moduleTitle">Module</h2>
            <div class="toolbar">
              <input id="rowSearch" type="search" placeholder="Search records..." />
              <select id="statusFilter">
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <p id="accessNote" class="access-note">Read-only operational intelligence view.</p>
        </section>`;

  const formPanel = `<section id="formPanel" class="panel form-panel">
          <h3>Executive Insights</h3>
          <ul class="activity-feed">
            <li>Live records are visible in a professional analytics table.</li>
            <li>Use filters, status views, and search to monitor operations quickly.</li>
            <li>Create/update/delete actions are intentionally disabled in this dashboard.</li>
          </ul>
        </section>`;

  const tablePanel = `<section class="panel table-panel">
          <div id="tableWrap" class="table-wrap"></div>
          <div class="pager">
            <button id="prevPageBtn" type="button" class="btn secondary">Previous</button>
            <span id="pageLabel">Page 1</span>
            <button id="nextPageBtn" type="button" class="btn secondary">Next</button>
          </div>
        </section>`;

  const bannerPanel = `<section class="panel workspace-banner"><h3>${layoutProfile.workspaceLabel}</h3></section>`;
  const quickActionsPanel = `<section class="panel intelligence-panel">
          <h3>Quick Actions</h3>
          <div class="quick-actions">
            <button type="button" class="btn secondary">Export CSV</button>
            <button type="button" class="btn secondary">Schedule Report</button>
            <button type="button" class="btn secondary">Create Automation</button>
          </div>
        </section>`;
  const activityPanel = `<section class="panel intelligence-panel">
          <h3>Recent Activity</h3>
          <ul class="activity-feed">
            <li>Module loaded and synced with role policy.</li>
            <li>Data table connected to live API records.</li>
            <li>Dashboard is running in read-only intelligence mode.</li>
          </ul>
        </section>`;

  if (layoutProfile.layoutClass === "layout-adaptive") {
    if (visualProfile?.key === "airy") {
      return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass} visual-layout-adaptive visual-layout-adaptive-airy">
          <section class="panel adaptive-hero">
            <div class="adaptive-hero-text">
              <h3>${layoutProfile.workspaceLabel}</h3>
              <p>Prompt-aware workspace generated with responsive navigation, role policy, and live module controls.</p>
            </div>
            <div class="adaptive-hero-tags">
              <span>Role-aware</span>
              <span>Executive UI</span>
              <span>Responsive</span>
            </div>
          </section>
          <section class="adaptive-columns">
            <section class="adaptive-left">
              ${statsBlock}
              ${moduleControlBlock}
              ${formPanel}
            </section>
            <section class="adaptive-right">
              ${tablePanel}
              ${activityPanel}
            </section>
          </section>
        </main>`;
    }
    if (visualProfile?.key === "slate") {
      return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass} visual-layout-adaptive visual-layout-adaptive-slate">
          <section class="adaptive-slate-grid">
            <aside class="adaptive-slate-rail">
              ${bannerPanel}
              ${statsBlock}
              ${quickActionsPanel}
            </aside>
            <section class="adaptive-slate-main">
              ${moduleControlBlock}
              ${tablePanel}
              ${formPanel}
              ${activityPanel}
            </section>
          </section>
        </main>`;
    }
    return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass} visual-layout-adaptive visual-layout-adaptive-executive">
        <section class="panel adaptive-command-banner">
          <div class="command-copy">
            <h3>${layoutProfile.workspaceLabel}</h3>
            <p>Executive command surface for requirement-driven operations, approvals, and records.</p>
          </div>
          <div class="command-tags">
            <span>Live Modules</span>
            <span>Audit Trail</span>
            <span>Role Policy</span>
          </div>
        </section>
        <section class="adaptive-kpi">
          ${statsBlock}
        </section>
        <section class="adaptive-grid">
          <section class="adaptive-main">
            ${moduleControlBlock}
            ${tablePanel}
          </section>
          <aside class="adaptive-side">
            ${formPanel}
            ${quickActionsPanel}
            ${activityPanel}
          </aside>
        </section>
      </main>`;
  }

  if (visualProfile?.key === "executive") {
    return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass} visual-layout-executive">
        <section class="kpi-strip">
          ${statsBlock}
        </section>
        <section class="executive-grid">
          <aside class="executive-rail">
            ${bannerPanel}
            ${moduleControlBlock}
            ${formPanel}
          </aside>
          <section class="executive-main">
            ${tablePanel}
          </section>
        </section>
      </main>`;
  }

  if (visualProfile?.key === "airy") {
    return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass} visual-layout-airy">
        <section class="panel airy-hero">
          <div class="airy-hero-text">
            <h3>${layoutProfile.workspaceLabel}</h3>
            <p>Module workflows and live records are grouped into focused workspace cards.</p>
          </div>
        </section>
        ${statsBlock}
        ${moduleControlBlock}
        <section class="airy-stack">
          ${tablePanel}
          ${formPanel}
        </section>
      </main>`;
  }

  if (visualProfile?.key === "slate") {
    return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass} visual-layout-slate">
        <section class="slate-grid">
          <section class="slate-primary">
            ${moduleControlBlock}
            ${tablePanel}
          </section>
          <aside class="slate-secondary">
            ${statsBlock}
            ${bannerPanel}
            ${formPanel}
          </aside>
        </section>
      </main>`;
  }

  if (layoutProfile.layoutClass === "layout-healthcare" || layoutProfile.layoutClass === "layout-fitness") {
    return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass}">
        <section class="content-left">
          ${statsBlock}
          ${moduleControlBlock}
        </section>
        <section class="content-right">
          ${bannerPanel}
          ${formPanel}
          ${tablePanel}
        </section>
      </main>`;
  }

  if (
    layoutProfile.layoutClass === "layout-ecommerce" ||
    layoutProfile.layoutClass === "layout-fooddelivery" ||
    layoutProfile.layoutClass === "layout-crm"
  ) {
    return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass}">
        ${bannerPanel}
        ${statsBlock}
        <section class="split-panels">
          <section class="split-left">
            ${moduleControlBlock}
            ${formPanel}
          </section>
          <section class="split-right">
            ${tablePanel}
          </section>
        </section>
      </main>`;
  }

  return `<main id="contentArea" class="dash-content ${layoutProfile.layoutClass}">
        ${statsBlock}
        ${moduleControlBlock}
        ${formPanel}
        ${tablePanel}
      </main>`;
}

function buildProfessionalDashboardFiles(userPrompt, plan, frontendRoot = "frontend") {
  const domainKey = detectDomainTemplateKey(userPrompt, plan);
  const modules = inferDashboardModules(userPrompt, plan, domainKey);
  const adaptiveBlueprint =
    domainKey === ADAPTIVE_DOMAIN_KEY ? buildAdaptiveStyleBlueprint(userPrompt, plan, modules) : null;
  const domainLabel = adaptiveBlueprint?.focusTitle || toTitleCase(domainKey === ADAPTIVE_DOMAIN_KEY ? "Operations" : domainKey);
  const baseTheme = getDomainTheme(domainKey);
  const theme = adaptiveBlueprint
    ? {
        ...baseTheme,
        bg: adaptiveBlueprint.dashboard.bg,
        panel: adaptiveBlueprint.dashboard.panel,
        primary: adaptiveBlueprint.dashboard.primary,
        accent: adaptiveBlueprint.dashboard.accent,
        text: adaptiveBlueprint.dashboard.text,
      }
    : baseTheme;
  const baseProfile = getDomainStyleProfile(domainKey);
  const profile = adaptiveBlueprint
    ? {
        ...baseProfile,
        className: `style-adaptive style-adaptive-${adaptiveBlueprint.key}`,
        icon: adaptiveBlueprint.icon,
        subtitle: adaptiveBlueprint.subtitle,
        metricLabels: adaptiveBlueprint.metricLabels,
        fontStack: adaptiveBlueprint.fontStack,
      }
    : baseProfile;
  const visualProfile = pickDashboardVisualVariant(userPrompt, plan, domainKey, modules);
  const baseLayout = getDomainLayoutProfile(domainKey);
  const layoutProfile = adaptiveBlueprint
    ? {
        ...baseLayout,
        workspaceLabel: adaptiveBlueprint.workspaceLabel,
      }
    : baseLayout;
  const prefix = frontendRoot ? `${frontendRoot.replace(/\/+$/, "")}/` : "";
  const contentLayout = buildDomainContentLayout(profile, layoutProfile, visualProfile);
  const pageTitleText = domainKey === ADAPTIVE_DOMAIN_KEY ? `${domainLabel} Command Center` : `${domainLabel} Operations`;
  const modulePreview = (modules || [])
    .map((m) => String(m?.label || "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ");
  const pageSubtitleText = `${profile.subtitle} - ${visualProfile.subtitleSuffix}${modulePreview ? ` | Modules: ${modulePreview}` : ""}`;

  const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${domainLabel} Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Urbanist:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="style.css" />
  <link rel="stylesheet" href="dashboard.css" />
</head>
<body class="dash-theme ${profile.className} ${visualProfile.className}">
  <div class="dash-layout">
    <aside class="dash-sidebar">
      <div class="brand">${profile.icon} ${domainLabel}</div>
      <nav id="sidebarNav" class="sidebar-nav"></nav>
    </aside>
    <div class="dash-main">
      <header class="dash-header">
        <div class="header-left">
          <p class="header-kicker">Intelligence Workspace</p>
          <h1 id="pageTitle">${pageTitleText}</h1>
          <p id="pageSubtitle">${pageSubtitleText}</p>
        </div>
        <div class="header-center">
          <input id="topSearch" class="top-search" type="search" placeholder="Search modules or records..." />
        </div>
        <div class="header-right">
          <button id="notifBtn" class="icon-btn" type="button" aria-label="Notifications">Alerts</button>
          <div class="user-meta">
            <span id="userName">User</span>
            <span id="roleBadge" class="role-badge">user</span>
          </div>
          <button id="logoutBtn" class="btn secondary" type="button">Logout</button>
        </div>
      </header>
      ${contentLayout}
    </div>
  </div>
  <div id="toastHost" class="toast-host" aria-live="polite" aria-atomic="true"></div>
  <script src="script.js"></script>
  <script src="dashboard.js"></script>
</body>
</html>`;

  const dashboardCss = `:root {
  --dash-bg: ${theme.bg};
  --dash-panel: ${theme.panel};
  --dash-primary: ${theme.primary};
  --dash-accent: ${theme.accent};
  --dash-text: ${theme.text};
  --dash-muted: ${adaptiveBlueprint?.dashboard.muted || "#64748b"};
  --dash-border: ${adaptiveBlueprint?.dashboard.border || "#dbe4ef"};
  --dash-header-bg: ${adaptiveBlueprint?.dashboard.headerBg || "#f0fdfa"};
  --dash-sidebar-gradient: ${adaptiveBlueprint?.dashboard.sidebarGradient || "linear-gradient(180deg, #0f766e, #14b8a6)"};
  --dash-radius: 12px;
  --dash-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
  --dash-font: ${profile.fontStack};
}

body { margin: 0; background: var(--dash-bg); color: var(--dash-text); font-family: var(--dash-font); }
.dash-layout { min-height: 100vh; display: grid; grid-template-columns: 260px 1fr; }
.dash-sidebar { background: var(--dash-primary); color: #fff; padding: 18px 14px; position: sticky; top: 0; height: 100vh; }
.brand { font-size: 1.2rem; font-weight: 700; margin-bottom: 14px; letter-spacing: 0.3px; }
.sidebar-nav { display: grid; gap: 8px; }
.sidebar-item { border: 0; border-radius: 10px; background: rgba(255,255,255,0.12); color: #fff; text-align: left; padding: 10px 12px; cursor: pointer; }
.sidebar-item.active { background: #fff; color: var(--dash-primary); font-weight: 600; }
.dash-main { display: grid; grid-template-rows: auto 1fr; min-width: 0; }
.dash-header { position: sticky; top: 0; z-index: 10; background: #fff; border-bottom: 1px solid var(--dash-border); padding: 14px 18px; display: flex; justify-content: space-between; gap: 14px; }
.header-left h1 { margin: 0; font-size: 1.15rem; }
.header-left p { margin: 4px 0 0; color: var(--dash-muted); font-size: 0.92rem; }
.header-right { display: flex; align-items: center; gap: 10px; }
.icon-btn { border: 1px solid var(--dash-border); background: #fff; border-radius: 10px; padding: 8px 10px; cursor: pointer; }
.user-meta { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--dash-border); border-radius: 10px; background: #fff; }
.role-badge { display: inline-block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.4px; padding: 2px 8px; border-radius: 999px; background: var(--dash-accent); color: #fff; }
.dash-content { padding: 16px; display: grid; gap: 14px; }
.workspace-banner { border: 0; background: linear-gradient(135deg, rgba(15,23,42,0.04), rgba(15,23,42,0)); }
.workspace-banner h3 { margin: 0; font-size: 0.95rem; color: var(--dash-primary); letter-spacing: 0.2px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.stat-card { background: var(--dash-panel); border: 1px solid var(--dash-border); border-radius: var(--dash-radius); box-shadow: var(--dash-shadow); padding: 12px; }
.stat-card h3 { margin: 0 0 6px; font-size: 0.9rem; color: var(--dash-muted); }
.stat-card p { margin: 0; font-size: 1.45rem; font-weight: 700; color: var(--dash-primary); }
.panel { background: var(--dash-panel); border: 1px solid var(--dash-border); border-radius: var(--dash-radius); box-shadow: var(--dash-shadow); padding: 12px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.panel-head h2 { margin: 0; font-size: 1rem; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.toolbar input, .toolbar select, .module-form input, .module-form textarea, .module-form select { border: 1px solid var(--dash-border); border-radius: 10px; padding: 9px 10px; font-size: 0.92rem; width: 100%; }
.module-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.module-form .full { grid-column: 1 / -1; }
.btn { border: 0; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-weight: 600; }
.btn.primary { background: var(--dash-primary); color: #fff; }
.btn.secondary { background: #eef2f7; color: var(--dash-text); }
.table-wrap { overflow: auto; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { border-bottom: 1px solid var(--dash-border); text-align: left; padding: 9px 8px; font-size: 0.9rem; vertical-align: top; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.access-note { margin: 8px 0 0; color: var(--dash-muted); font-size: 0.9rem; }
.pager { margin-top: 10px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; }

/* Layout variants */
.dash-content.layout-healthcare,
.dash-content.layout-fitness {
  grid-template-columns: minmax(260px, 0.95fr) minmax(420px, 1.55fr);
  align-items: start;
}
.dash-content.layout-healthcare .content-left,
.dash-content.layout-healthcare .content-right,
.dash-content.layout-fitness .content-left,
.dash-content.layout-fitness .content-right {
  display: grid;
  gap: 12px;
}
.dash-content.layout-ecommerce,
.dash-content.layout-fooddelivery,
.dash-content.layout-crm {
  display: grid;
  gap: 12px;
}
.split-panels {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(420px, 1.4fr);
  gap: 12px;
}
.split-left,
.split-right { display: grid; gap: 12px; align-content: start; }

/* Visual layout variants (structural) */
.visual-layout-executive .kpi-strip .stats-grid {
  grid-template-columns: repeat(3, minmax(160px, 1fr));
}
.visual-layout-executive .executive-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.95fr) minmax(520px, 1.5fr);
  gap: 14px;
  align-items: start;
}
.visual-layout-executive .executive-rail,
.visual-layout-executive .executive-main {
  display: grid;
  gap: 12px;
  align-content: start;
}
.visual-layout-executive .executive-rail {
  position: sticky;
  top: 84px;
}

.visual-layout-airy .airy-hero {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), rgba(14, 165, 233, 0.08));
}
.visual-layout-airy .airy-hero h3 {
  margin: 0 0 6px;
  font-size: 1.05rem;
}
.visual-layout-airy .airy-hero p {
  margin: 0;
  color: var(--dash-muted);
}
.visual-layout-airy .airy-stack {
  display: grid;
  grid-template-columns: 1.55fr 0.95fr;
  gap: 14px;
  align-items: start;
}
.visual-layout-airy .form-panel {
  position: sticky;
  top: 84px;
}

.visual-layout-slate .slate-grid {
  display: grid;
  grid-template-columns: minmax(560px, 1.6fr) minmax(320px, 1fr);
  gap: 14px;
  align-items: start;
}
.visual-layout-slate .slate-primary,
.visual-layout-slate .slate-secondary {
  display: grid;
  gap: 12px;
  align-content: start;
}
.visual-layout-slate .slate-secondary .stats-grid {
  grid-template-columns: 1fr;
}

/* Domain style variants */
.dash-theme.style-healthcare .dash-sidebar { background: linear-gradient(180deg, #1d4ed8, #0ea5e9); }
.dash-theme.style-healthcare .dash-header { border-bottom-width: 2px; }
.dash-theme.style-healthcare .stat-card { border-left: 4px solid var(--dash-accent); }

.dash-theme.style-fitness .dash-sidebar { background: linear-gradient(180deg, #166534, #22c55e); }
.dash-theme.style-fitness .dash-header { background: #f8fff9; }
.dash-theme.style-fitness .stat-card { border-radius: 16px; }

.dash-theme.style-education .dash-sidebar { background: linear-gradient(180deg, #4338ca, #6366f1); }
.dash-theme.style-education .dash-header { background: #f8f7ff; }
.dash-theme.style-education .panel { border-style: dashed; }

.dash-theme.style-crm .dash-sidebar { background: linear-gradient(180deg, #0f766e, #14b8a6); }
.dash-theme.style-crm .dash-header { background: #f6fffe; }
.dash-theme.style-crm .stat-card p { letter-spacing: 0.3px; }

.dash-theme.style-realestate .dash-sidebar { background: linear-gradient(180deg, #1d4ed8, #0ea5e9); }
.dash-theme.style-realestate .dash-header { background: #f4f8ff; }
.dash-theme.style-realestate .panel { border-radius: 14px; }

.dash-theme.style-ecommerce .dash-sidebar { background: linear-gradient(180deg, #b45309, #f59e0b); }
.dash-theme.style-ecommerce .dash-header { background: #fffaf5; }
.dash-theme.style-ecommerce .panel { border-radius: 14px; }

.dash-theme.style-fooddelivery .dash-sidebar { background: linear-gradient(180deg, #e23744, #ff6b6b); }
.dash-theme.style-fooddelivery .dash-header { background: #fff7f8; }
.dash-theme.style-fooddelivery .panel { border-radius: 16px; }
.dash-theme.style-fooddelivery .stat-card { border-left: 4px solid var(--dash-accent); }

.dash-theme.style-adaptive .dash-sidebar { background: var(--dash-sidebar-gradient); }
.dash-theme.style-adaptive .dash-header { background: var(--dash-header-bg); }
.dash-theme.style-adaptive .panel { border-radius: 14px; }
.dash-theme.style-adaptive .stat-card { border-left: 4px solid var(--dash-accent); }

/* Prompt-driven visual variants */
.dash-theme.visual-executive .dash-header {
  border-bottom-width: 2px;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
}
.dash-theme.visual-executive .panel,
.dash-theme.visual-executive .stat-card {
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}
.dash-theme.visual-executive .sidebar-item {
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.dash-theme.visual-airy .dash-content {
  gap: 18px;
  padding: 20px;
}
.dash-theme.visual-airy .panel,
.dash-theme.visual-airy .stat-card {
  border-radius: 18px;
}
.dash-theme.visual-airy .dash-header {
  padding: 16px 22px;
}

.dash-theme.visual-slate .dash-sidebar {
  background: linear-gradient(180deg, #0f172a, #1e293b);
}
.dash-theme.visual-slate .dash-header {
  background: #f1f5f9;
}
.dash-theme.visual-slate .panel {
  background: #f8fafc;
  border-color: #cbd5e1;
}
.dash-theme.visual-slate .stat-card p {
  letter-spacing: 0.4px;
}
.dash-theme.visual-slate .data-table th {
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
}

@media (max-width: 980px) {
  .dash-layout { grid-template-columns: 1fr; }
  .dash-sidebar { position: static; height: auto; }
  .sidebar-nav { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
  .dash-content.layout-healthcare,
  .dash-content.layout-fitness {
    grid-template-columns: 1fr;
  }
  .split-panels { grid-template-columns: 1fr; }
  .visual-layout-executive .executive-grid,
  .visual-layout-airy .airy-stack,
  .visual-layout-slate .slate-grid {
    grid-template-columns: 1fr;
  }
  .visual-layout-executive .executive-rail,
  .visual-layout-airy .form-panel {
    position: static;
  }
}

/* Modern dashboard overhaul */
body {
  background:
    radial-gradient(circle at 5% 8%, rgba(148, 163, 184, 0.12), transparent 30%),
    radial-gradient(circle at 95% 12%, rgba(148, 163, 184, 0.12), transparent 30%),
    var(--dash-bg);
}
.dash-layout {
  grid-template-columns: 280px 1fr;
}
.dash-sidebar {
  background: var(--dash-sidebar-gradient);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.08);
}
.brand {
  margin-bottom: 16px;
  font-size: 1.36rem;
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.sidebar-item {
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  padding: 11px 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  transition: transform 0.18s ease, background 0.2s ease, box-shadow 0.2s ease;
}
.sidebar-entry {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.sidebar-token {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.24);
  font-size: 0.72rem;
  letter-spacing: 0.03em;
}
.sidebar-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-chevron {
  opacity: 0.72;
}
.sidebar-item:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 10px 22px rgba(2, 12, 27, 0.28);
}
.sidebar-item.active {
  background: #ffffff;
  color: var(--dash-primary);
  box-shadow: 0 10px 22px rgba(2, 12, 27, 0.2);
}
.sidebar-item.active .sidebar-token {
  background: rgba(15, 23, 42, 0.08);
  border-color: rgba(15, 23, 42, 0.12);
}

.dash-main {
  grid-template-rows: auto 1fr;
}
.dash-header {
  top: 10px;
  margin: 10px 12px 0;
  border: 1px solid var(--dash-border);
  border-radius: 18px;
  background: linear-gradient(145deg, var(--dash-header-bg), #ffffff);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.12);
  padding: 14px 16px;
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(260px, 0.9fr) auto;
  align-items: center;
  gap: 14px;
}
.header-kicker {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--dash-muted);
  font-weight: 700;
}
.header-left h1 {
  margin-top: 4px;
  font-size: 1.45rem;
  letter-spacing: -0.01em;
}
.header-left p {
  margin-top: 4px;
  font-size: 0.95rem;
}
.header-center {
  width: 100%;
}
.top-search {
  width: 100%;
  border: 1px solid var(--dash-border);
  border-radius: 12px;
  padding: 11px 12px;
  font-size: 0.9rem;
  background: #ffffff;
  outline: none;
}
.top-search:focus {
  border-color: var(--dash-accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
}
.header-right {
  justify-self: end;
}
.icon-btn,
.user-meta,
.btn.secondary {
  border-radius: 12px;
}

.dash-content {
  padding: 16px 14px 18px;
  gap: 16px;
}
.stat-card {
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.1);
}
.stat-card h3 {
  font-size: 0.95rem;
}
.stat-card p {
  font-size: 1.9rem;
}
.panel {
  border-radius: 16px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
}
.workspace-banner {
  background: linear-gradient(130deg, rgba(255,255,255,0.96), rgba(243, 247, 255, 0.88));
}
.workspace-banner h3 {
  font-size: 1.1rem;
}
.module-head-panel .panel-head h2 {
  font-size: 1.25rem;
}
.toolbar input,
.toolbar select,
.module-form input,
.module-form textarea,
.module-form select {
  border-radius: 12px;
  padding: 11px 12px;
}
.module-form {
  gap: 12px;
}
.module-form .actions {
  grid-column: 1 / -1;
  justify-content: flex-start;
}
.module-form .btn.primary {
  border-radius: 12px;
  padding: 11px 14px;
}
.data-table th {
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--dash-muted);
}
.data-table td {
  font-size: 0.92rem;
}
.pager {
  margin-top: 14px;
}
.toast-host {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  gap: 8px;
  z-index: 120;
  width: min(480px, calc(100vw - 24px));
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  border-radius: 12px;
  border: 1px solid var(--dash-border);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.16);
  padding: 10px 12px;
  background: #ffffff;
  color: var(--dash-text);
  font-size: 0.9rem;
}
.toast.success { border-color: rgba(22, 163, 74, 0.3); background: #f0fdf4; }
.toast.error { border-color: rgba(220, 38, 38, 0.3); background: #fef2f2; }
.toast.info { border-color: rgba(14, 165, 233, 0.35); background: #eff6ff; }
.visual-layout-adaptive .adaptive-grid {
  display: grid;
  grid-template-columns: minmax(560px, 1.55fr) minmax(340px, 0.95fr);
  gap: 16px;
  align-items: start;
}
.visual-layout-adaptive .adaptive-main,
.visual-layout-adaptive .adaptive-side {
  display: grid;
  gap: 14px;
  align-content: start;
}
.visual-layout-adaptive .adaptive-side .form-panel {
  position: sticky;
  top: 112px;
}
.visual-layout-adaptive-executive .adaptive-command-banner {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(236, 244, 255, 0.92));
}
.visual-layout-adaptive-executive .adaptive-command-banner h3 {
  margin: 0;
  font-size: 1.08rem;
  color: var(--dash-primary);
}
.visual-layout-adaptive-executive .adaptive-command-banner p {
  margin: 6px 0 0;
  color: var(--dash-muted);
  font-size: 0.9rem;
}
.command-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.command-tags span {
  border-radius: 999px;
  border: 1px solid var(--dash-border);
  background: #ffffff;
  padding: 6px 10px;
  font-size: 0.8rem;
}
.visual-layout-adaptive-airy .adaptive-hero {
  display: grid;
  gap: 10px;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.96), rgba(241, 249, 255, 0.92));
}
.adaptive-hero-text h3 {
  margin: 0;
  font-size: 1.12rem;
  color: var(--dash-primary);
}
.adaptive-hero-text p {
  margin: 6px 0 0;
  color: var(--dash-muted);
  font-size: 0.92rem;
}
.adaptive-hero-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.adaptive-hero-tags span {
  border-radius: 999px;
  border: 1px solid var(--dash-border);
  background: #ffffff;
  padding: 6px 10px;
  font-size: 0.8rem;
}
.visual-layout-adaptive-airy .adaptive-columns {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(520px, 1.4fr);
  gap: 14px;
  align-items: start;
}
.visual-layout-adaptive-airy .adaptive-left,
.visual-layout-adaptive-airy .adaptive-right {
  display: grid;
  gap: 12px;
}
.visual-layout-adaptive-airy .adaptive-left .form-panel {
  position: sticky;
  top: 112px;
}
.visual-layout-adaptive-slate .adaptive-slate-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(600px, 1.6fr);
  gap: 14px;
  align-items: start;
}
.visual-layout-adaptive-slate .adaptive-slate-rail,
.visual-layout-adaptive-slate .adaptive-slate-main {
  display: grid;
  gap: 12px;
}
.visual-layout-adaptive-slate .adaptive-slate-rail {
  position: sticky;
  top: 112px;
}
.intelligence-panel h3 {
  margin: 0 0 10px;
  font-size: 1rem;
  color: var(--dash-primary);
}
.quick-actions {
  display: grid;
  gap: 8px;
}
.quick-actions .btn.secondary {
  width: 100%;
  justify-content: center;
}
.activity-feed {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  color: var(--dash-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

@media (max-width: 1220px) {
  .dash-header {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .header-right {
    justify-self: start;
  }
}
@media (max-width: 980px) {
  .dash-sidebar { padding: 12px; }
  .brand { font-size: 1.3rem; }
  .dash-header {
    margin: 8px 8px 0;
    top: 6px;
  }
  .dash-content {
    padding: 10px 8px 12px;
  }
  .visual-layout-adaptive .adaptive-grid {
    grid-template-columns: 1fr;
  }
  .visual-layout-adaptive .adaptive-side .form-panel,
  .visual-layout-adaptive-airy .adaptive-left .form-panel,
  .visual-layout-adaptive-slate .adaptive-slate-rail {
    position: static;
  }
  .visual-layout-adaptive-airy .adaptive-columns,
  .visual-layout-adaptive-slate .adaptive-slate-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .sidebar-nav {
    grid-template-columns: 1fr;
  }
  .user-meta {
    max-width: 100%;
  }
}
`;

  const modulesJson = JSON.stringify(modules);
  const adaptiveRoleKeys =
    domainKey === ADAPTIVE_DOMAIN_KEY
      ? inferAdaptiveRoleOptions(userPrompt, plan).map((role) => String(role?.value || "").trim()).filter(Boolean)
      : [];
  const adaptiveAccessHints =
    domainKey === ADAPTIVE_DOMAIN_KEY
      ? extractRoleAccessHints(userPrompt, modules)
      : { canWriteByRole: {} };
  const roleConfigJson = JSON.stringify(getDomainRolePolicy(domainKey, modules, adaptiveRoleKeys, adaptiveAccessHints));
  const roleAliasJson = JSON.stringify(getDomainRoleAliases(domainKey));
  const domainKeyJson = JSON.stringify(domainKey);

  const dashboardJs = `(function () {
  var token = localStorage.getItem("token") || "";
  if (!token) { location.href = "login.html"; return; }

  var storedUser = {};
  try { storedUser = JSON.parse(localStorage.getItem("user") || "{}"); } catch (_err) { storedUser = {}; }

  function decodeJwtPayload(tokenValue) {
    try {
      var parts = String(tokenValue || "").split(".");
      if (parts.length < 2) return {};
      var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      var json = decodeURIComponent(atob(b64).split("").map(function (ch) {
        return "%" + ("00" + ch.charCodeAt(0).toString(16)).slice(-2);
      }).join(""));
      return JSON.parse(json);
    } catch (_err) {
      return {};
    }
  }

  var payload = decodeJwtPayload(token);
  var currentUser = {
    name: String(storedUser.name || payload.name || payload.email || "User"),
    role: String(storedUser.role || payload.role || "user").toLowerCase()
  };

  var DOMAIN_KEY = ${domainKeyJson};
  var API_BASE = String(window.APP_API_BASE || ((location.origin || "") + "/api")).replace(/\\/+$/, "");
  var PROJECT_KEY = (function () {
    try {
      var params = new URLSearchParams(String(location.search || ""));
      var fromQuery = String(params.get("projectKey") || "").trim();
      if (fromQuery) {
        localStorage.setItem("PROJECT_KEY", fromQuery);
        return fromQuery;
      }
      var path = String(location.pathname || "");
      var match = path.match(/\\/generated_projects\\/([^/]+)\\//i) || path.match(/\\/preview_projects\\/([^/]+)\\//i);
      var fromPath = String((match && match[1]) || "").trim();
      if (fromPath) {
        localStorage.setItem("PROJECT_KEY", fromPath);
        return fromPath;
      }
      return String(localStorage.getItem("PROJECT_KEY") || "").trim();
    } catch (_err) {
      return "";
    }
  })();
  var MODULES = ${modulesJson};
  var ROLE_PERMISSIONS = ${roleConfigJson};
  var ROLE_ALIASES = ${roleAliasJson};
  var pageSize = 8;
  var pageIndex = 1;
  var activeModule = MODULES[0] || { key: "records", label: "Records", fields: [] };
  var allRows = [];
  var editingRowId = null;

  function normalizeRole(role) {
    var raw = String(role || "user").toLowerCase();
    if (ROLE_ALIASES[raw]) return String(ROLE_ALIASES[raw] || raw);
    return raw;
  }

  currentUser.role = normalizeRole(currentUser.role);

  function permissionsForRole(role) {
    var normalizedRole = normalizeRole(role);
    if (ROLE_PERMISSIONS[normalizedRole]) return ROLE_PERMISSIONS[normalizedRole];
    return ROLE_PERMISSIONS.user || { canView: [], canWrite: [] };
  }

  function canViewModule(moduleKey) {
    return permissionsForRole(currentUser.role).canView.indexOf(moduleKey) !== -1;
  }

  function canWriteModule(moduleKey) {
    // Professional dashboard is intentionally read-only.
    return false;
  }

  function setHeader() {
    var userName = document.getElementById("userName");
    var roleBadge = document.getElementById("roleBadge");
    if (userName) userName.textContent = currentUser.name;
    if (roleBadge) roleBadge.textContent = currentUser.role;
  }

  function moduleToken(label) {
    var parts = String(label || "")
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) { return String(part || "").charAt(0).toUpperCase(); })
      .join("");
    return parts || "MD";
  }

  function showToast(message, type) {
    var host = document.getElementById("toastHost");
    if (!host) return;
    var toast = document.createElement("div");
    toast.className = "toast " + String(type || "info");
    toast.textContent = String(message || "Action completed");
    host.appendChild(toast);
    setTimeout(function () {
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2800);
  }

  function recordFieldValue(row, fieldName) {
    if (!row || !fieldName) return "";
    var key = String(fieldName || "");
    if (row.data && Object.prototype.hasOwnProperty.call(row.data, key)) return row.data[key];
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    return "";
  }

  function renderSidebar() {
    var nav = document.getElementById("sidebarNav");
    if (!nav) return;
    nav.innerHTML = "";
    var visibleModules = MODULES.filter(function (module) { return canViewModule(module.key); });
    if (!visibleModules.length) {
      nav.innerHTML = "<p style=\\"margin:0;opacity:0.85\\">No modules available for this role.</p>";
      return;
    }
    if (!canViewModule(activeModule.key)) activeModule = visibleModules[0];
    visibleModules.forEach(function (module) {
      if (!canViewModule(module.key)) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-item" + (activeModule.key === module.key ? " active" : "");
      var entry = document.createElement("span");
      entry.className = "sidebar-entry";
      var token = document.createElement("span");
      token.className = "sidebar-token";
      token.textContent = moduleToken(module.label);
      var label = document.createElement("span");
      label.className = "sidebar-label";
      label.textContent = module.label;
      entry.appendChild(token);
      entry.appendChild(label);
      var chevron = document.createElement("span");
      chevron.className = "sidebar-chevron";
      chevron.textContent = ">";
      button.appendChild(entry);
      button.appendChild(chevron);
      button.addEventListener("click", function () {
        if (!canViewModule(module.key)) return;
        activeModule = module;
        editingRowId = null;
        pageIndex = 1;
        renderSidebar();
        renderModule();
        loadRows();
      });
      nav.appendChild(button);
    });
  }

  function renderForm() {
    var form = document.getElementById("moduleForm");
    var formPanel = document.getElementById("formPanel");
    if (!form) return;
    form.innerHTML = "";
    var allowWrite = canWriteModule(activeModule.key);
    if (formPanel) formPanel.style.display = allowWrite ? "" : "none";
    if (!allowWrite) return;
    activeModule.fields.forEach(function (field) {
      var label = document.createElement("label");
      label.className = field.type === "textarea" ? "full" : "";
      label.textContent = field.label;
      var input;
      if (field.type === "textarea") {
        input = document.createElement("textarea");
        input.className = "full";
      } else if (field.type === "status") {
        input = document.createElement("select");
        ["active", "pending", "completed", "archived"].forEach(function (state) {
          var opt = document.createElement("option");
          opt.value = state;
          opt.textContent = state;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement("input");
        input.type = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "time" ? "time" : "text";
      }
      input.name = field.name;
      if (field.required) input.required = true;
      label.appendChild(input);
      form.appendChild(label);
    });

    var actions = document.createElement("div");
    actions.className = "full actions";
    var saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "btn primary";
    saveBtn.textContent = editingRowId ? ("Update " + activeModule.label) : ("Save " + activeModule.label);
    actions.appendChild(saveBtn);
    if (editingRowId) {
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn secondary";
      cancelBtn.textContent = "Cancel Edit";
      cancelBtn.addEventListener("click", function () {
        editingRowId = null;
        renderForm();
      });
      actions.appendChild(cancelBtn);
    }
    form.appendChild(actions);
  }

  function renderModule() {
    var pageTitle = document.getElementById("pageTitle");
    var moduleTitle = document.getElementById("moduleTitle");
    var accessNote = document.getElementById("accessNote");
    if (pageTitle) pageTitle.textContent = activeModule.label + " Command View";
    if (moduleTitle) moduleTitle.textContent = activeModule.label + " Records";
    if (accessNote) {
      accessNote.textContent = "Role: " + currentUser.role + ". Read-only analytics access.";
    }
  }

  function computeFilteredRows() {
    var q = String((document.getElementById("rowSearch") || {}).value || "").toLowerCase().trim();
    var status = String((document.getElementById("statusFilter") || {}).value || "").toLowerCase().trim();
    var filtered = allRows.filter(function (row) {
      var moduleKey = String((row && row.data && row.data.entityType) || row.entityType || "").toLowerCase();
      if (moduleKey !== activeModule.key) return false;
      if (status && String(row.status || "").toLowerCase() !== status) return false;
      if (!q) return true;
      var merged = [row.name, row.description, JSON.stringify(row.data || {})].join(" ").toLowerCase();
      return merged.indexOf(q) !== -1;
    });
    return filtered;
  }

  function updateMetrics(filtered) {
    var total = filtered.length;
    var active = filtered.filter(function (x) { return String(x.status || "").toLowerCase() === "active"; }).length;
    var today = new Date().toISOString().slice(0, 10);
    var updated = filtered.filter(function (x) { return String(x.updatedAt || x.createdAt || "").slice(0, 10) === today; }).length;
    var metricTotal = document.getElementById("metricTotal");
    var metricActive = document.getElementById("metricActive");
    var metricUpdated = document.getElementById("metricUpdated");
    if (metricTotal) metricTotal.textContent = String(total);
    if (metricActive) metricActive.textContent = String(active);
    if (metricUpdated) metricUpdated.textContent = String(updated);
  }

  function renderTable() {
    var tableWrap = document.getElementById("tableWrap");
    if (!tableWrap) return;
    var filtered = computeFilteredRows();
    updateMetrics(filtered);
    var start = (pageIndex - 1) * pageSize;
    var paged = filtered.slice(start, start + pageSize);

    var html = "<table class=\\"data-table\\"><thead><tr><th>Name</th><th>Status</th><th>Description</th><th>Updated</th></tr></thead><tbody>";
    if (!paged.length) {
      html += "<tr><td colspan=\\"4\\">No records found for this module.</td></tr>";
    } else {
      paged.forEach(function (row) {
        html += "<tr>";
        html += "<td>" + String(row.name || "-") + "</td>";
        html += "<td>" + String(row.status || "-") + "</td>";
        html += "<td>" + String(row.description || "-") + "</td>";
        html += "<td>" + String(row.updatedAt || row.createdAt || "-") + "</td>";
        html += "</tr>";
      });
    }
    html += "</tbody></table>";
    tableWrap.innerHTML = html;

    var pageLabel = document.getElementById("pageLabel");
    if (pageLabel) {
      var pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      pageLabel.textContent = "Page " + pageIndex + " of " + pages;
    }
  }

  function startEditRow(id) {
    if (!canWriteModule(activeModule.key)) return;
    var row = allRows.find(function (item) { return String(item && item.id) === String(id); });
    if (!row) {
      showToast("Record not found for editing.", "error");
      return;
    }
    editingRowId = row.id;
    renderForm();
    var form = document.getElementById("moduleForm");
    if (!form) return;
    activeModule.fields.forEach(function (field) {
      var input = form.elements[field.name];
      if (!input) return;
      var value = recordFieldValue(row, field.name);
      if (value === null || typeof value === "undefined") value = "";
      input.value = String(value);
    });
    var statusField = form.elements.status;
    if (statusField && !String(statusField.value || "").trim()) {
      statusField.value = String(row.status || "active");
    }
    showToast("Editing record: " + String(row.name || row.id), "info");
  }

  async function loadRows() {
    try {
      var query = "?entityType=" + encodeURIComponent(activeModule.key);
      if (PROJECT_KEY) query += "&projectKey=" + encodeURIComponent(PROJECT_KEY);
      var res = await fetch(API_BASE + "/projects" + query, {
        headers: {
          Authorization: "Bearer " + token,
          "X-Project-Key": PROJECT_KEY
        }
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.message || "Failed to load records");
      allRows = Array.isArray(data.projects) ? data.projects : [];
    } catch (err) {
      allRows = [];
      var tableWrap = document.getElementById("tableWrap");
      if (tableWrap) tableWrap.innerHTML = "<p>" + String(err.message || "Failed to load records") + "</p>";
      showToast(String(err.message || "Failed to load records"), "error");
      return;
    }
    renderTable();
  }

  async function submitForm(event) {
    event.preventDefault();
    if (!canWriteModule(activeModule.key)) {
      showToast("You only have view access for this module.", "error");
      return;
    }
    var form = document.getElementById("moduleForm");
    if (!form) return;
    var formData = new FormData(form);
    var payload = { entityType: activeModule.key };
    if (PROJECT_KEY) payload.projectKey = PROJECT_KEY;
    activeModule.fields.forEach(function (field) {
      payload[field.name] = formData.get(field.name);
    });
    payload.name = payload.name || payload.title || payload.itemName || activeModule.label + " Record";
    payload.description = payload.description || payload.notes || "";
    payload.status = payload.status || "active";
    try {
      var isEditing = Boolean(editingRowId);
      var endpoint = isEditing
        ? (API_BASE + "/projects/" + encodeURIComponent(editingRowId))
        : (API_BASE + "/projects");
      var method = isEditing ? "PUT" : "POST";
      var res = await fetch(endpoint, {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "X-Project-Key": PROJECT_KEY
        },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.message || "Save failed");
      form.reset();
      editingRowId = null;
      renderForm();
      showToast(isEditing ? "Record updated successfully." : "Record created successfully.", "success");
      await loadRows();
    } catch (err) {
      showToast(String(err.message || "Save failed"), "error");
    }
  }

  async function deleteRow(id) {
    if (!canWriteModule(activeModule.key)) return;
    if (!confirm("Delete this record?")) return;
    try {
      var res = await fetch(API_BASE + "/projects/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + token,
          "X-Project-Key": PROJECT_KEY
        }
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.message || "Delete failed");
      if (editingRowId && String(editingRowId) === String(id)) {
        editingRowId = null;
        renderForm();
      }
      showToast("Record deleted successfully.", "success");
      await loadRows();
    } catch (err) {
      showToast(String(err.message || "Delete failed"), "error");
    }
  }

  function bindEvents() {
    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        location.href = "login.html";
      });
    }
    var notifBtn = document.getElementById("notifBtn");
    if (notifBtn) {
      notifBtn.addEventListener("click", function () {
        showToast("No new alerts. System is synced.", "info");
      });
    }
    var rowSearch = document.getElementById("rowSearch");
    if (rowSearch) rowSearch.addEventListener("input", function () { pageIndex = 1; renderTable(); });
    var topSearch = document.getElementById("topSearch");
    if (topSearch) {
      topSearch.addEventListener("input", function () {
        var rowInput = document.getElementById("rowSearch");
        if (rowInput) rowInput.value = topSearch.value;
        pageIndex = 1;
        renderTable();
      });
    }
    var statusFilter = document.getElementById("statusFilter");
    if (statusFilter) statusFilter.addEventListener("change", function () { pageIndex = 1; renderTable(); });
    var prevBtn = document.getElementById("prevPageBtn");
    var nextBtn = document.getElementById("nextPageBtn");
    if (prevBtn) prevBtn.addEventListener("click", function () { pageIndex = Math.max(1, pageIndex - 1); renderTable(); });
    if (nextBtn) nextBtn.addEventListener("click", function () {
      var pages = Math.max(1, Math.ceil(computeFilteredRows().length / pageSize));
      pageIndex = Math.min(pages, pageIndex + 1);
      renderTable();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setHeader();
    renderSidebar();
    renderModule();
    bindEvents();
    loadRows();
  });
})();`;

  return [
    { path: `${prefix}dashboard.html`, content: dashboardHtml },
    { path: `${prefix}dashboard.css`, content: dashboardCss },
    { path: `${prefix}dashboard.js`, content: dashboardJs },
  ];
}

function readTemplateFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return "";
  }
}

function buildLockedTemplateFiles(userPrompt, plan, frontendRoot = "frontend", styleSeed = "") {
  const domainKey = detectDomainTemplateKey(userPrompt, plan);
  const useLockedDomainTemplates = isLockedDomainTemplateKey(domainKey);
  const dynamicShellFiles = useLockedDomainTemplates
    ? []
    : buildDynamicShellPages(userPrompt, plan, frontendRoot, styleSeed);
  const dynamicShellKeys = new Set(dynamicShellFiles.map((item) => normalizePathKey(item.path)));
  const prefix = frontendRoot ? `${frontendRoot.replace(/\/+$/, "")}/` : "";

  const files = [...dynamicShellFiles];
  if (!useLockedDomainTemplates) {
    // For adaptive/non-locked domains, avoid static base template fallback so output can flex by requirements.
    return files;
  }
  for (const fileName of LOCKED_FRONTEND_FILES) {
    if (dynamicShellFiles.length && DYNAMIC_SHELL_FILES.has(fileName)) continue;
    const domainPath = path.join(TEMPLATE_ROOT, "domains", domainKey, "frontend", fileName);
    const basePath = path.join(BASE_FRONTEND_TEMPLATE_DIR, fileName);
    const targetPath = `${prefix}${fileName}`;
    if (dynamicShellKeys.has(normalizePathKey(targetPath))) continue;
    const content = readTemplateFileIfExists(domainPath) || readTemplateFileIfExists(basePath);
    if (!content) continue;
    files.push({ path: targetPath, content });
  }
  return files;
}

function buildBaselineTemplateFiles(userPrompt, plan, frontendRoot = "frontend") {
  const domainKey = detectDomainTemplateKey(userPrompt, plan);
  if (!isLockedDomainTemplateKey(domainKey)) return [];
  const domainFrontendDir = path.join(TEMPLATE_ROOT, "domains", domainKey, "frontend");
  const prefix = frontendRoot ? `${frontendRoot.replace(/\/+$/, "")}/` : "";
  const files = [];
  for (const fileName of BASELINE_FRONTEND_FILES) {
    const domainPath = path.join(domainFrontendDir, fileName);
    const basePath = path.join(BASE_FRONTEND_TEMPLATE_DIR, fileName);
    const content =
      readTemplateFileIfExists(domainPath) ||
      readTemplateFileIfExists(basePath);
    if (!content) continue;
    files.push({ path: `${prefix}${fileName}`, content });
  }
  return files;
}

function mergeLockedTemplateFiles(existingFiles, lockedFiles) {
  const lockedKeys = new Set((lockedFiles || []).map((f) => normalizePathKey(f.path)));
  const kept = (Array.isArray(existingFiles) ? existingFiles : []).filter(
    (f) => !lockedKeys.has(normalizePathKey(f?.path || ""))
  );
  return [...kept, ...(lockedFiles || [])];
}

function mergeMissingTemplateFiles(existingFiles, missingDefaults) {
  const out = Array.isArray(existingFiles) ? [...existingFiles] : [];
  const existingKeys = new Set(out.map((f) => normalizePathKey(f?.path || "")));
  for (const item of missingDefaults || []) {
    const key = normalizePathKey(item?.path || "");
    if (!key || existingKeys.has(key)) continue;
    out.push(item);
    existingKeys.add(key);
  }
  return out;
}

function buildGeneratedSvgAsset(label, index = 0) {
  const title = escapeHtml(toTitleCase(String(label || `Image ${index + 1}`)));
  const hueA = (hashString(`${label || "image"}:${index}:a`) + 360) % 360;
  const hueB = (hashString(`${label || "image"}:${index}:b`) + 360) % 360;
  const hueC = (hashString(`${label || "image"}:${index}:c`) + 360) % 360;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">Generated visual for ${title}</desc>
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hueA} 88% 56%)"/>
      <stop offset="100%" stop-color="hsl(${hueB} 82% 45%)"/>
    </linearGradient>
    <linearGradient id="g2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hueC} 78% 62% / 0.85)"/>
      <stop offset="100%" stop-color="hsl(${hueA} 72% 34% / 0.65)"/>
    </linearGradient>
  </defs>
  <rect width="1536" height="864" fill="url(#g1)"/>
  <circle cx="1230" cy="180" r="260" fill="url(#g2)"/>
  <circle cx="280" cy="690" r="300" fill="url(#g2)" opacity="0.78"/>
  <g fill="white" opacity="0.95">
    <rect x="92" y="92" rx="20" ry="20" width="570" height="86" fill="rgba(15,23,42,0.22)"/>
    <text x="122" y="147" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="40" font-weight="700">${title}</text>
  </g>
  <g fill="white" opacity="0.84">
    <text x="122" y="210" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="24">Generated from prompt requirements</text>
  </g>
</svg>
`;
}

function upsertFileContent(files, filePath, content) {
  const targetKey = normalizePathKey(filePath);
  const out = [];
  let replaced = false;
  for (const item of Array.isArray(files) ? files : []) {
    const itemPath = normalizeToPosixPath(item?.path || "");
    if (normalizePathKey(itemPath) === targetKey) {
      out.push({ path: itemPath, content: String(content || "") });
      replaced = true;
    } else {
      out.push(item);
    }
  }
  if (!replaced) out.push({ path: normalizeToPosixPath(filePath), content: String(content || "") });
  return out;
}

function toRelativeAssetPath(fromFilePath, assetFilePath) {
  const from = normalizeToPosixPath(fromFilePath);
  const to = normalizeToPosixPath(assetFilePath);
  const fromDir = path.posix.dirname(from);
  let relative = path.posix.relative(fromDir, to);
  if (!relative || relative.startsWith("/")) relative = to;
  if (!relative.startsWith(".") && !relative.startsWith("/")) relative = `./${relative}`;
  return relative;
}

function injectGeneratedImageGallery(htmlContent, items = []) {
  const html = String(htmlContent || "");
  if (!html || !Array.isArray(items) || !items.length) return html;
  if (html.includes('id="generatedImageGallery"')) return html;
  const cards = items.map((item) => {
    const src = String(item?.src || "").trim();
    const alt = escapeHtml(String(item?.alt || "Generated visual").trim());
    const label = escapeHtml(String(item?.label || "").trim());
    if (!src) return "";
    return `<figure style="margin:0;border:1px solid rgba(15,23,42,0.12);border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 10px 24px rgba(15,23,42,0.08);"><img src="${src}" alt="${alt}" loading="lazy" style="display:block;width:100%;height:160px;object-fit:cover;background:#e5e7eb"/><figcaption style="padding:10px 12px;font:600 13px/1.4 Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">${label}</figcaption></figure>`;
  }).filter(Boolean).join("");
  if (!cards) return html;
  const section = `<section id="generatedImageGallery" style="margin-top:18px;padding:14px;border-radius:16px;border:1px solid rgba(15,23,42,0.12);background:linear-gradient(135deg,rgba(255,255,255,0.96),rgba(240,249,255,0.92));"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px;"><h3 style="margin:0;font:700 1.05rem/1.3 Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">Generated Visuals</h3><p style="margin:0;font:500 0.86rem/1.3 Inter,Segoe UI,Arial,sans-serif;color:#475569;">Prompt-driven images based on requested modules</p></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">${cards}</div></section>`;
  if (/<\/main>/i.test(html)) return html.replace(/<\/main>/i, `${section}\n</main>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${section}\n</body>`);
  return `${html}\n${section}`;
}

function applyPromptDrivenImageAssets(payload, userPrompt, plan, imageConfig = {}) {
  if (!payload || !Array.isArray(payload.files)) return payload;
  if (!imageConfig?.enabled) return payload;

  const imageCount = toBoundedPositiveInt(imageConfig.count, AI_DEFAULT_IMAGE_COUNT);
  const labels = (Array.isArray(imageConfig.labels) ? imageConfig.labels : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, imageCount);
  if (!labels.length) return payload;

  const frontendRoot = detectFrontendRoot(payload.files);
  const prefix = frontendRoot ? `${frontendRoot.replace(/\/+$/, "")}/` : "";
  const imageDir = `${prefix}assets/generated-images`;

  let files = [...payload.files];
  const usedNames = new Set();
  const imageItems = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    const base = safeModuleKey(label) || "visual";
    let fileName = `${base}.svg`;
    let suffix = 2;
    while (usedNames.has(fileName)) {
      fileName = `${base}-${suffix}.svg`;
      suffix += 1;
    }
    usedNames.add(fileName);
    const filePath = `${imageDir}/${fileName}`;
    const svg = buildGeneratedSvgAsset(label, i);
    files = mergeMissingTemplateFiles(files, [{ path: filePath, content: svg }]);
    imageItems.push({ label, filePath, fileName });
  }

  const manifestPath = `${imageDir}/manifest.json`;
  const manifestPayload = imageItems.map((item, idx) => ({
    id: idx + 1,
    label: item.label,
    file: item.fileName,
    path: normalizeToPosixPath(item.filePath),
  }));
  files = upsertFileContent(files, manifestPath, `${JSON.stringify(manifestPayload, null, 2)}\n`);

  const htmlCandidates = files
    .map((f) => normalizeToPosixPath(f?.path || ""))
    .filter((p) => p.toLowerCase().endsWith(".html"));
  const targetHtml =
    htmlCandidates.find((p) => /(^|\/)dashboard\.html$/i.test(p)) ||
    htmlCandidates.find((p) => /(^|\/)index\.html$/i.test(p)) ||
    htmlCandidates[0] ||
    "";
  if (targetHtml) {
    const current = files.find((f) => normalizePathKey(f?.path || "") === normalizePathKey(targetHtml));
    if (current && typeof current.content === "string") {
      const previewItems = imageItems.slice(0, Math.min(6, imageItems.length)).map((item) => ({
        label: item.label,
        alt: `${item.label} image`,
        src: toRelativeAssetPath(targetHtml, item.filePath),
      }));
      const updatedHtml = injectGeneratedImageGallery(current.content, previewItems);
      files = upsertFileContent(files, targetHtml, updatedHtml);
    }
  }

  return {
    ...payload,
    files,
  };
}

function applyTemplateLocksToPayload(payload, userPrompt, plan, preferredFrontendRoot = "", styleSeed = "") {
  if (!payload || !Array.isArray(payload.files)) return payload;
  const domainKey = detectDomainTemplateKey(userPrompt, plan);
  const useLockedDomainTemplates = isLockedDomainTemplateKey(domainKey);
  const frontendRoot = preferredFrontendRoot || detectFrontendRoot(payload.files);
  const lockedFiles = buildLockedTemplateFiles(userPrompt, plan, frontendRoot, styleSeed);
  const baselineFiles = buildBaselineTemplateFiles(userPrompt, plan, frontendRoot);
  const shouldApplyProDashboard =
    AI_ENFORCE_PRO_DASHBOARD &&
    (!AI_LOCK_DOMAIN_TEMPLATES || !useLockedDomainTemplates || !lockedFiles.length);
  const proDashboardFiles = shouldApplyProDashboard
    ? buildProfessionalDashboardFiles(userPrompt, plan, frontendRoot)
    : [];
  if (!lockedFiles.length && !baselineFiles.length && !proDashboardFiles.length) return payload;
  // Keep pro dashboard as a fallback style layer only.
  // Domain-locked templates must be merged after this so LMS/healthcare/etc. dashboards are not overwritten.
  const withProDashboard = proDashboardFiles.length
    ? mergeLockedTemplateFiles(payload.files, proDashboardFiles)
    : payload.files;
  const withLocked = AI_LOCK_DOMAIN_TEMPLATES && lockedFiles.length
    ? mergeLockedTemplateFiles(withProDashboard, lockedFiles)
    : withProDashboard;
  const withBaseline = AI_LOCK_DOMAIN_TEMPLATES && baselineFiles.length
    ? mergeMissingTemplateFiles(withLocked, baselineFiles)
    : withLocked;
  return {
    ...payload,
    files: withBaseline,
    lockedTemplateRoot: frontendRoot,
    lockedTemplateDomain: domainKey,
  };
}

function buildFallbackFiles(userPrompt, plan) {
  const promptLower = String(userPrompt || "").toLowerCase();
  const title = (plan?.projectName || "generated-app").replace(/-/g, " ");
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const promptText = String(userPrompt || "").slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (promptLower.includes("snake")) {
    return {
      projectName: plan?.projectName || "snake-game",
      files: [
        {
          path: "index.html",
          content:
            "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Snake Game</title><link rel='stylesheet' href='style.css'></head><body><div class='wrap'><h1>Snake Game</h1><div class='hud'><span id='score'>Score: 0</span><button id='restart'>Restart</button></div><canvas id='game' width='420' height='420'></canvas><p>Use Arrow Keys to play</p></div><script src='script.js'></script></body></html>",
        },
        {
          path: "style.css",
          content:
            "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:Segoe UI,Arial,sans-serif}.wrap{text-align:center}.hud{display:flex;gap:12px;justify-content:center;align-items:center;margin:8px 0 12px}canvas{background:#111827;border:2px solid #334155;border-radius:8px}button{padding:8px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer}",
        },
        {
          path: "script.js",
          content:
            "const canvas=document.getElementById('game');const ctx=canvas.getContext('2d');const S=21,N=20;let snake=[{x:10,y:10}],dir={x:1,y:0},food={x:5,y:5},score=0,dead=false;function rnd(){return Math.floor(Math.random()*N)}function placeFood(){food={x:rnd(),y:rnd()};if(snake.some(s=>s.x===food.x&&s.y===food.y))placeFood()}function draw(){ctx.fillStyle='#111827';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#22c55e';snake.forEach(s=>ctx.fillRect(s.x*S,s.y*S,S-1,S-1));ctx.fillStyle='#ef4444';ctx.fillRect(food.x*S,food.y*S,S-1,S-1)}function step(){if(dead)return;const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(head.x<0||head.y<0||head.x>=N||head.y>=N||snake.some(s=>s.x===head.x&&s.y===head.y)){dead=true;return;}snake.unshift(head);if(head.x===food.x&&head.y===food.y){score+=1;document.getElementById('score').textContent='Score: '+score;placeFood()}else{snake.pop()}draw()}addEventListener('keydown',e=>{const m={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];if(!m)return;const [dx,dy]=m;if(dx===-dir.x&&dy===-dir.y)return;dir={x:dx,y:dy}});document.getElementById('restart').onclick=()=>{snake=[{x:10,y:10}];dir={x:1,y:0};score=0;dead=false;document.getElementById('score').textContent='Score: 0';placeFood();draw()};placeFood();draw();setInterval(step,120);",
        },
        {
          path: "README.md",
          content:
            "# Snake Game\n\n## Run\nOpen `index.html` in your browser.\n\n## Features\n- Keyboard controls\n- Collision + score\n- Restart button\n",
        },
      ],
    };
  }

  return {
    projectName: plan?.projectName || "generated-app",
    files: [
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: plan?.projectName || "generated-app",
            version: "1.0.0",
            private: true,
            scripts: { start: "node server.js" },
            dependencies: { express: "^4.18.2" },
          },
          null,
          2
        ),
      },
      {
        path: "server.js",
        content:
          "const express=require('express');const path=require('path');const app=express();const PORT=process.env.PORT||5000;app.use(express.static(path.join(__dirname,'public')));app.get('/api/health',(req,res)=>res.json({ok:true}));app.listen(PORT,()=>console.log('Server running on http://localhost:'+PORT));",
      },
      {
        path: "public/index.html",
        content: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main><h1>${safeTitle}</h1><p>${promptText}</p></main></body></html>`,
      },
      { path: "public/style.css", content: "body{font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0}main{max-width:900px;margin:40px auto;padding:16px}" },
      { path: ".env.example", content: "PORT=5000\n" },
      { path: "README.md", content: `# ${safeTitle}\n\nGenerated with fallback scaffold.\n\n## Run\nnpm install\nnpm start\n` },
    ],
  };
}

async function withRetries(fn, attempts = 2) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function hasFatalValidationIssues(validation) {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  if (!issues.length) return false;
  const fatalPatterns = [
    /no files generated/i,
    /payload is not an object/i,
    /invalid file path/i,
    /duplicate path/i,
    /absolute path not allowed/i,
    /missing readme\.md/i,
    /missing server entry or html entry file/i,
    /package\.json is not valid json/i,
    /missing package\.json for app stack/i,
    /missing local module for import/i,
    /likely truncated\/incomplete file content/i,
    /bundled multi-file text detected/i,
    /server entry does not start an http server/i,
  ];
  return issues.some((issue) => fatalPatterns.some((re) => re.test(String(issue || ""))));
}

async function generateValidFilesPayload(userPrompt, plan, requestId = "", styleSeed = "", generationOptions = {}) {
  const fileAttempts = Number(process.env.GENERATOR_FILE_ATTEMPTS || 2);
  const repairAttempts = Number(process.env.GENERATOR_REPAIR_ATTEMPTS || 2);
  const imageConfig = resolvePromptImageConfig(userPrompt, plan, generationOptions);

  let initialPayload;
  try {
    initialPayload = await withRetries(async () => {
      upsertGenerationProgress(requestId, {
        stage: "generating-files",
        message: "Generating project files",
      });
      const raw = await generateFromLLM(buildFilesPrompt(userPrompt, plan, imageConfig));
      const parsed = parseJsonSafe(raw);
      const normalized = normalizeFilePayload(parsed, plan.projectName || "generated-app");
      const locked = applyTemplateLocksToPayload(normalized, userPrompt, plan, "", styleSeed);
      const withImages = applyPromptDrivenImageAssets(locked, userPrompt, plan, imageConfig);
      if (!validateFilePayload(withImages)) {
        const keys = parsed && typeof parsed === "object" ? Object.keys(parsed).join(",") : "non-object";
        throw new Error(`Invalid files payload (keys=${keys})`);
      }
      return withImages;
    }, fileAttempts);
  } catch (firstError) {
    // Some small models return plan JSON again; force a strict files-only retry.
    try {
      upsertGenerationProgress(requestId, {
        stage: "strict-files-retry",
        message: "Retrying with strict files-only generation",
      });
      const strictRaw = await generateFromLLM(buildStrictFilesOnlyPrompt(userPrompt, plan, imageConfig));
      const strictParsed = parseJsonSafe(strictRaw);
      const strictNormalized = normalizeFilePayload(strictParsed, plan.projectName || "generated-app");
      const lockedStrict = applyTemplateLocksToPayload(strictNormalized, userPrompt, plan, "", styleSeed);
      const withImagesStrict = applyPromptDrivenImageAssets(lockedStrict, userPrompt, plan, imageConfig);
      if (validateFilePayload(withImagesStrict)) {
        initialPayload = withImagesStrict;
      } else {
        const fallback = applyTemplateLocksToPayload(buildFallbackFiles(userPrompt, plan), userPrompt, plan, "", styleSeed);
        return applyPromptDrivenImageAssets(fallback, userPrompt, plan, imageConfig);
      }
    } catch (_) {
      const fallback = applyTemplateLocksToPayload(buildFallbackFiles(userPrompt, plan), userPrompt, plan, "", styleSeed);
      return applyPromptDrivenImageAssets(fallback, userPrompt, plan, imageConfig);
    }
  }

  const validationContext = {
    ...plan,
    userPrompt,
  };
  let payload = initialPayload;
  let validation = validateGeneratedPayload(payload, validationContext);
  if (!validation.ok) {
    const qualityPatched = patchLowQualityJsFiles(payload, validation.issues);
    if (qualityPatched.patchedFiles.length) {
      payload = qualityPatched.payload;
      validation = validateGeneratedPayload(payload, validationContext);
      upsertGenerationProgress(requestId, {
        stage: "repairing",
        message: `Auto-healed ${qualityPatched.patchedFiles.length} low-quality JS file(s)`,
      });
    }
  }
  if (!validation.ok) {
    const autoPatched = patchMissingLocalImports(payload, validation.issues);
    if (autoPatched.addedFiles.length) {
      payload = autoPatched.payload;
      validation = validateGeneratedPayload(payload, validationContext);
      upsertGenerationProgress(requestId, {
        stage: "repairing",
        message: `Auto-created ${autoPatched.addedFiles.length} missing local module file(s)`,
      });
    }
  }

  for (let i = 1; !validation.ok && i <= repairAttempts; i += 1) {
    upsertGenerationProgress(requestId, {
      stage: "repairing",
      message: `Repair pass ${i}/${repairAttempts}`,
    });
    const raw = await generateFromLLM(buildRepairPrompt(validationContext, payload, validation.issues, imageConfig));
    const repaired = parseJsonSafe(raw);
    const normalized = normalizeFilePayload(repaired, plan.projectName || "generated-app");
    const locked = applyTemplateLocksToPayload(normalized, userPrompt, plan, "", styleSeed);
    const withImages = applyPromptDrivenImageAssets(locked, userPrompt, plan, imageConfig);
    if (!validateFilePayload(withImages)) continue;
    payload = withImages;
    validation = validateGeneratedPayload(payload, validationContext);
    if (!validation.ok) {
      const qualityPatched = patchLowQualityJsFiles(payload, validation.issues);
      if (qualityPatched.patchedFiles.length) {
        payload = qualityPatched.payload;
        validation = validateGeneratedPayload(payload, validationContext);
        upsertGenerationProgress(requestId, {
          stage: "repairing",
          message: `Auto-healed ${qualityPatched.patchedFiles.length} low-quality JS file(s)`,
        });
      }
    }
    if (!validation.ok) {
      const autoPatched = patchMissingLocalImports(payload, validation.issues);
      if (autoPatched.addedFiles.length) {
        payload = autoPatched.payload;
        validation = validateGeneratedPayload(payload, validationContext);
        upsertGenerationProgress(requestId, {
          stage: "repairing",
          message: `Auto-created ${autoPatched.addedFiles.length} missing local module file(s)`,
        });
      }
    }
  }

  if (!validation.ok) {
    const fatal = hasFatalValidationIssues(validation);
    if (fatal) {
      console.warn(`Validation failed after repair. Using fallback scaffold. Issues: ${validation.issues.join("; ")}`);
      const fallback = applyTemplateLocksToPayload(buildFallbackFiles(userPrompt, plan), userPrompt, plan, "", styleSeed);
      return applyPromptDrivenImageAssets(fallback, userPrompt, plan, imageConfig);
    }
    console.warn(`Validation had non-fatal issues; keeping generated payload. Issues: ${validation.issues.join("; ")}`);
  }

  const finalLocked = applyTemplateLocksToPayload(payload, userPrompt, plan, "", styleSeed);
  return applyPromptDrivenImageAssets(finalLocked, userPrompt, plan, imageConfig);
}

function saveBlueprint(projectDir, blueprint) {
  fs.writeFileSync(
    path.join(projectDir, "project_blueprint.json"),
    JSON.stringify(blueprint, null, 2),
    "utf8"
  );
}

function loadBlueprint(projectDir) {
  const p = path.join(projectDir, "project_blueprint.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

router.post("/", async (req, res) => {
  const requestId = sanitizeRequestId(
    req.body?.requestId || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  try {
    const wantsExecutable = String(req.body?.buildExecutable ?? process.env.AI_ENABLE_EXE_BUILD ?? "false").toLowerCase() === "true";
    const requireExecutable = String(req.body?.requireExecutable ?? process.env.AI_REQUIRE_EXE_BUILD ?? "false").toLowerCase() === "true";
    const exeTimeoutMs = Number(process.env.AI_EXE_BUILD_TIMEOUT_MS || (25 * 60 * 1000));
    const userPrompt = String(
      req.body?.prompt ||
      req.body?.description ||
      req.body?.appDesc ||
      req.body?.requirement ||
      req.body?.requirements ||
      req.body?.text ||
      req.query?.prompt ||
      ""
    ).trim();
    if (!userPrompt) {
      upsertGenerationProgress(requestId, {
        status: "failed",
        stage: "validation",
        message: "Prompt is missing",
      });
      return res.status(400).json({
        success: false,
        message: "prompt is required",
        requestId,
        acceptedFields: [
          "prompt",
          "description",
          "appDesc",
          "requirement",
          "requirements",
          "text",
        ],
      });
    }
    const styleSeed = `${Date.now()}_${requestId}`;

    upsertGenerationProgress(requestId, {
      status: "running",
      stage: "planning",
      message: "Generating project plan",
    });
    const plan = await withRetries(async () => {
      const raw = await generateFromLLM(buildPlanPrompt(userPrompt));
      const parsed = parseJsonSafe(raw);
      if (!validatePlan(parsed)) throw new Error("Invalid plan payload");
      return parsed;
    }, Number(process.env.GENERATOR_PLAN_ATTEMPTS || 2));

    const projectPayload = await generateValidFilesPayload(userPrompt, plan, requestId, styleSeed, {
      includeAiImages: req.body?.includeAiImages,
      aiImageCount: req.body?.aiImageCount,
    });

    upsertGenerationProgress(requestId, {
      stage: "building",
      message: "Writing files and creating project archive",
    });

    const { projectName, projectDir } = buildProject({
      projectName: projectPayload.projectName || plan.projectName,
      files: projectPayload.files,
    });

    const projectDbConfig = readProjectDbConfig();
    const databaseName = writePerProjectDatabaseEnv(projectDir, projectName, projectDbConfig);
    let databaseProvisioned = false;
    let databaseProvisionError = "";
    if (AI_CREATE_PROJECT_DATABASES) {
      upsertGenerationProgress(requestId, {
        stage: "provisioning_database",
        message: `Provisioning database ${databaseName}`,
      });
      try {
        await ensureProjectDatabaseExists(databaseName, projectDbConfig);
        databaseProvisioned = true;
      } catch (dbErr) {
        // Do not fail full generation when DB server is unavailable.
        databaseProvisionError = String(dbErr?.message || "Database provisioning failed");
        upsertGenerationProgress(requestId, {
          stage: "provisioning_database",
          message: `Database provision warning: ${databaseProvisionError}`,
        });
      }
    }

    saveBlueprint(projectDir, {
      prompt: userPrompt,
      plan,
      styleSeed,
      databaseName,
      databaseProvisioned,
      databaseProvisionError,
      databaseHost: projectDbConfig.host,
      databasePort: projectDbConfig.port,
      databaseUser: projectDbConfig.user,
      createdAt: new Date().toISOString(),
    });

    const zipName = `${projectName}.zip`;
    const zipPath = path.join(projectDir, zipName);
    await zipProject(projectDir, zipPath);

    let executableDownloadURL = "";
    let executableBuildError = "";
    if (wantsExecutable) {
      upsertGenerationProgress(requestId, {
        stage: "packaging_executable",
        message: "Building Windows executable (.exe)",
      });
      try {
        const streamExeLog = (chunk) => {
          const raw = String(chunk || "").trim();
          if (!raw) return;
          const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (!lines.length) return;
          const tailLine = lines[lines.length - 1].slice(0, 260);
          upsertGenerationProgress(requestId, {
            stage: "packaging_executable",
            message: tailLine || "Packaging executable",
          });
        };
        const exeResult = await buildElectronExecutable({
          projectDir,
          projectName,
          timeoutMs: exeTimeoutMs,
          onProgress: (msg) => upsertGenerationProgress(requestId, {
            stage: "packaging_executable",
            message: String(msg || "Packaging executable"),
          }),
          onLog: streamExeLog,
        });
        executableDownloadURL = String(exeResult?.downloadURL || "");
      } catch (exeErr) {
        executableBuildError = String(exeErr?.message || "Executable build failed");
        upsertGenerationProgress(requestId, {
          stage: "packaging_executable",
          message: `EXE build failed: ${executableBuildError}`,
        });
        if (requireExecutable) {
          throw new Error(executableBuildError);
        }
      }
    }

    const generatedImageAssetCount = projectPayload.files.filter((file) =>
      /assets\/generated-images\//i.test(String(file?.path || "").replace(/\\/g, "/"))
    ).length;

    return res.json({
      success: true,
      message: "Project generated",
      requestId,
      plan,
      generatedFiles: projectPayload.files,
      lockedTemplateDomain: projectPayload.lockedTemplateDomain || "",
      lockedTemplateRoot: projectPayload.lockedTemplateRoot || "",
      projectName,
      projectDir,
      zipPath,
      zipURL: `/generated_projects/${projectName}/${zipName}`,
      fileCount: projectPayload.files.length,
      generatedImageAssetCount,
      databaseName,
      databaseProvisioned,
      databaseProvisionError,
      blueprintPath: `/generated_projects/${projectName}/project_blueprint.json`,
      executableDownloadURL,
      executableURL: executableDownloadURL,
      executableBuildError,
    });
  } catch (error) {
    upsertGenerationProgress(requestId, {
      status: "failed",
      stage: "failed",
      message: error.message || "Generation failed",
    });
    return res.status(502).json({
      success: false,
      message: error.message || "Generation failed",
      requestId,
    });
  } finally {
    const current = generationProgress.get(requestId);
    if (current && current.status !== "failed") {
      upsertGenerationProgress(requestId, {
        status: "completed",
        stage: "completed",
        message: "Project generation completed",
      });
    }
  }
});

router.post("/refine", async (req, res) => {
  try {
    const projectName = String(req.body?.projectName || "").trim();
    const changeRequest = String(req.body?.changeRequest || "").trim();
    if (!projectName || !changeRequest) {
      return res.status(400).json({ success: false, message: "projectName and changeRequest are required" });
    }

    const projectDir = getProjectDir(projectName);
    const existingBlueprint = loadBlueprint(projectDir);
    if (!existingBlueprint?.plan) {
      return res.status(400).json({ success: false, message: "project_blueprint.json not found for this project" });
    }

    const updatedPlanRaw = await generateFromLLM(
      buildRefinePlanPrompt(changeRequest, existingBlueprint.plan)
    );
    const updatedPlan = parseJsonSafe(updatedPlanRaw);
    if (!validatePlan(updatedPlan)) {
      return res.status(502).json({ success: false, message: "Invalid updated plan from model" });
    }

    const currentFiles = listProjectFiles(projectDir);
    const existingFrontendRoot = detectFrontendRoot(currentFiles);
    const refineFilesRaw = await generateFromLLM(
      buildRefineFilesPrompt(changeRequest, updatedPlan, currentFiles)
    );
    const refinePayload = parseJsonSafe(refineFilesRaw);
    const normalizedRefinePayload = normalizeFilePayload(refinePayload, projectName);
    const lockDetectionPrompt = [changeRequest, existingBlueprint?.prompt || ""]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join("\n");
    const lockedRefinePayload = applyTemplateLocksToPayload(
      normalizedRefinePayload,
      lockDetectionPrompt,
      updatedPlan,
      existingFrontendRoot,
      existingBlueprint?.styleSeed || projectName
    );
    if (!validateFilePayload(lockedRefinePayload)) {
      return res.status(502).json({ success: false, message: "Invalid refine files payload" });
    }

    writeFiles(projectDir, lockedRefinePayload.files);
    saveBlueprint(projectDir, {
      ...existingBlueprint,
      plan: updatedPlan,
      lastChangeRequest: changeRequest,
      updatedAt: new Date().toISOString(),
    });

    const zipName = `${projectName}.zip`;
    const zipPath = path.join(projectDir, zipName);
    await zipProject(projectDir, zipPath);

    return res.json({
      success: true,
      message: "Project refined",
      projectName,
      updatedFiles: lockedRefinePayload.files.map((f) => f.path),
      lockedTemplateDomain: lockedRefinePayload.lockedTemplateDomain || "",
      lockedTemplateRoot: lockedRefinePayload.lockedTemplateRoot || "",
      zipURL: `/generated_projects/${projectName}/${zipName}`,
      blueprintPath: `/generated_projects/${projectName}/project_blueprint.json`,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error.message || "Refine failed",
    });
  }
});

router.get("/:projectName/blueprint", (req, res) => {
  try {
    const projectDir = getProjectDir(req.params.projectName);
    const blueprint = loadBlueprint(projectDir);
    if (!blueprint) return res.status(404).json({ success: false, message: "Blueprint not found" });
    return res.json({ success: true, blueprint });
  } catch (error) {
    return res.status(404).json({ success: false, message: error.message });
  }
});

router.post("/preview/start/:projectName", async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const projectDir = getProjectDir(projectName);
    const info = await startPreview(projectName, projectDir);
    return res.json({ success: true, preview: info });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/preview/status/:projectName", (req, res) => {
  const info = getPreviewStatus(req.params.projectName);
  if (!info) return res.status(404).json({ success: false, message: "No running preview" });
  return res.json({ success: true, preview: info });
});

router.post("/preview/stop/:projectName", (req, res) => {
  const stopped = stopPreview(req.params.projectName);
  return res.json({ success: true, stopped });
});

router.post("/build-executable/:projectName", async (req, res) => {
  try {
    const projectName = String(req.params.projectName || "").trim();
    if (!projectName) {
      return res.status(400).json({ success: false, message: "projectName is required" });
    }
    const projectDir = getProjectDir(projectName);
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }
    const timeoutMs = Number(req.body?.timeoutMs || process.env.AI_EXE_BUILD_TIMEOUT_MS || (25 * 60 * 1000));
    const exeResult = await buildElectronExecutable({
      projectDir,
      projectName,
      timeoutMs,
    });
    const executableDownloadURL = String(exeResult?.downloadURL || "");
    return res.json({
      success: true,
      message: "Executable build completed",
      projectName,
      executableDownloadURL,
      executableURL: executableDownloadURL,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error.message || "Executable build failed",
    });
  }
});

router.get("/progress/:requestId", (req, res) => {
  const requestId = sanitizeRequestId(req.params.requestId);
  const progress = generationProgress.get(requestId) || null;
  if (!progress) {
    return res.status(404).json({ success: false, message: "Progress not found" });
  }
  return res.json({ success: true, progress });
});

router.get("/progress/stream/:requestId", (req, res) => {
  const requestId = sanitizeRequestId(req.params.requestId);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const writeProgress = () => {
    const progress = generationProgress.get(requestId) || null;
    if (!progress) {
      res.write(`event: progress\ndata: ${JSON.stringify({ progress: null })}\n\n`);
      return false;
    }
    res.write(`event: progress\ndata: ${JSON.stringify({ progress })}\n\n`);
    return progress.status !== "completed" && progress.status !== "failed";
  };

  writeProgress();
  const timer = setInterval(() => {
    const shouldContinue = writeProgress();
    if (!shouldContinue) {
      clearInterval(timer);
      res.end();
    }
  }, 700);

  req.on("close", () => {
    clearInterval(timer);
  });
});

module.exports = router;


