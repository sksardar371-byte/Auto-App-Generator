const path = require("path");
const { requestAICompletion } = require("./providerClient");
const { parseJsonSafe } = require("../../utils/jsonUtils");

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const ORCHESTRATOR_PLAN_ATTEMPTS = Number(process.env.AI_ORCHESTRATOR_PLAN_ATTEMPTS || 3);
const ORCHESTRATOR_TREE_ATTEMPTS = Number(process.env.AI_ORCHESTRATOR_TREE_ATTEMPTS || 3);
const ORCHESTRATOR_FILE_ATTEMPTS = Number(process.env.AI_ORCHESTRATOR_FILE_ATTEMPTS || 3);
const ORCHESTRATOR_MAX_FILES = Number(process.env.AI_ORCHESTRATOR_MAX_FILES || 70);

function buildProviderOptions(prompt) {
  const openAiModel = process.env.OPENAI_MODEL || "openai/gpt-4o-mini";
  const openAiFallbacks = String(process.env.OPENAI_MODEL_FALLBACKS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const ollamaFallbacks = String(process.env.OLLAMA_FALLBACK_MODELS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    provider: AI_PROVIDER,
    prompt,
    ollama: {
      baseURL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
      timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 180000),
      fallbackModels: ollamaFallbacks,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || "",
      preferredModels: [openAiModel],
      fallbackModels: openAiFallbacks,
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      geminiPreferredModels: (process.env.GEMINI_MODEL || "")
        ? [process.env.GEMINI_MODEL]
        : ["gemini-1.5-flash"],
      geminiFallbackModels: String(process.env.GEMINI_FALLBACK_MODELS || "gemini-1.5-pro")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    },
    huggingface: {
      token: process.env.HF_TOKEN || "",
      model: process.env.HF_MODEL || "",
      timeoutMs: Number(process.env.HF_TIMEOUT_MS || 120000),
    },
  };
}

function buildRepairPrompt(rawText, schemaLabel) {
  return `You must repair malformed model output into valid strict JSON.

Schema target: "${schemaLabel}"

Return ONLY valid JSON. No markdown. No explanation.

Malformed output:
${String(rawText || "").slice(0, 24000)}`;
}

async function askJson(prompt, schemaLabel, attempts = 2) {
  let currentPrompt = prompt;
  let lastError = null;
  const maxAttempts = Math.max(1, Number(attempts || 1));

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await requestAICompletion(buildProviderOptions(currentPrompt));
      const raw = response?.choices?.[0]?.message?.content || "";
      if (!String(raw).trim()) throw new Error("Model returned empty response");
      return parseJsonSafe(raw);
    } catch (err) {
      lastError = err;
      if (i >= maxAttempts - 1) break;
      currentPrompt = buildRepairPrompt(currentPrompt, schemaLabel);
    }
  }

  throw lastError || new Error(`Failed to produce valid JSON for ${schemaLabel}`);
}

function safePath(filePath) {
  let p = String(filePath || "").replace(/\\/g, "/").trim();
  p = p.replace(/^\.?\//, "");
  while (p.startsWith("/")) p = p.slice(1);
  if (!p || p.includes("..")) return "";
  return p;
}

function normalizeFilesPayload(payload) {
  const filesRaw =
    payload?.files ||
    payload?.project_files ||
    payload?.generated_files ||
    payload?.output?.files ||
    [];

  const normalized = (Array.isArray(filesRaw) ? filesRaw : [])
    .map((f) => {
      const filePath = safePath(
        f?.path ||
          f?.filePath ||
          f?.file_path ||
          f?.filename ||
          f?.name ||
          f?.target
      );
      if (!filePath) return null;
      return {
        path: filePath,
        content: String(f?.content ?? f?.code ?? f?.text ?? f?.body ?? ""),
      };
    })
    .filter(Boolean);

  return normalized;
}

function normalizeTree(payload) {
  const list = Array.isArray(payload?.files)
    ? payload.files
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.fileTree)
        ? payload.fileTree
        : [];

  const out = [];
  const seen = new Set();
  for (const item of list) {
    const p = safePath(typeof item === "string" ? item : item?.path || item?.filePath || item?.name);
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function buildPlanPrompt(description, language) {
  return `You are a senior full-stack architect.

Generate a complete structured JSON plan for a production-ready full stack application.

User idea:
"${description}"

Requirements:
- Backend: Node.js + Express
- Database: MySQL (or mock JSON if DB not required)
- Frontend: HTML, CSS, Vanilla JS
- REST API under /api
- Include authentication if applicable
- Include realistic seed/demo data
- App must not appear empty after start

Return ONLY valid JSON in this format:
{
  "projectName": "",
  "description": "",
  "features": [],
  "database": {
    "tables": [
      {
        "name": "",
        "fields": [
          { "name": "", "type": "" }
        ],
        "seedData": []
      }
    ]
  },
  "backend": {
    "routes": [],
    "middlewares": []
  },
  "frontend": {
    "pages": []
  }
}`;
}

function buildFileTreePrompt(plan, description, language) {
  return `Based on this architecture plan:
${JSON.stringify(plan, null, 2)}

User idea:
"${description}"
Language:
"${language}"

Generate ONLY the complete file structure.

Return JSON:
{
  "files": [
    "backend/server.js",
    "backend/package.json",
    "backend/routes/example.js",
    "backend/controllers/exampleController.js",
    "backend/models/exampleModel.js",
    "backend/config/db.js",
    "frontend/index.html",
    "frontend/style.css",
    "frontend/script.js",
    "README.md"
  ]
}

Rules:
- Include all required folders
- Include config, models, routes, controllers
- Include frontend files
- Include README
- Include seed file(s) when database entities exist
- Return ONLY JSON`;
}

function buildSingleFilePrompt(filePath, plan, description, language, existingPaths) {
  return `You are generating ONE file of a full stack application.

Project Architecture:
${JSON.stringify(plan, null, 2)}

User idea:
"${description}"

Backend language:
"${language}"

Current file set:
${JSON.stringify(existingPaths || [], null, 2)}

Generate ONLY this file:
${filePath}

Strict Rules:
- Return strict JSON only.
- Output schema: { "files": [ { "path": "${filePath}", "content": "..." } ] }
- Backend must use Express.
- Server must run on port 5000.
- API base path must be /api.
- Frontend must call /api endpoints.
- Include realistic seed/demo data where relevant.
- If authentication exists, include default admin:
  email: admin@example.com
  password: admin123
- No empty arrays for core domain resources.
- No TODO placeholders.
- File must be runnable and connected with other files.`;
}

function defaultPathsByLanguage(language) {
  const lang = String(language || "").toLowerCase();
  const common = [
    "README.md",
    ".env.example",
    "frontend/index.html",
    "frontend/style.css",
    "frontend/script.js",
  ];
  if (lang.includes("python")) {
    return [...common, "backend/server.py", "backend/requirements.txt"];
  }
  if (lang.includes("java")) {
    return [...common, "backend/pom.xml", "backend/src/main/java/Main.java"];
  }
  return [
    ...common,
    "backend/package.json",
    "backend/server.js",
    "backend/routes/auth.js",
    "backend/routes/projects.js",
  ];
}

function mergeUniquePaths(primary, secondary) {
  const out = [];
  const seen = new Set();
  for (const p of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const clean = safePath(p);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function upsertGeneratedFile(files, nextFile) {
  const target = safePath(nextFile?.path);
  if (!target) return;
  const idx = files.findIndex((f) => String(f.path || "").toLowerCase() === target.toLowerCase());
  const normalized = { path: target, content: String(nextFile?.content || "") };
  if (idx >= 0) files[idx] = normalized;
  else files.push(normalized);
}

async function generatePlan(description, language) {
  const planJson = await askJson(
    buildPlanPrompt(description, language),
    "plan",
    ORCHESTRATOR_PLAN_ATTEMPTS
  );
  return planJson;
}

async function generateFileTree(plan, description, language) {
  const treeJson = await askJson(
    buildFileTreePrompt(plan, description, language),
    "file-tree",
    ORCHESTRATOR_TREE_ATTEMPTS
  );
  return normalizeTree(treeJson);
}

async function generateSingleFile(filePath, plan, description, language, existingPaths) {
  const payload = await askJson(
    buildSingleFilePrompt(filePath, plan, description, language, existingPaths),
    `single-file:${filePath}`,
    ORCHESTRATOR_FILE_ATTEMPTS
  );
  const files = normalizeFilesPayload(payload);
  const match = files.find((f) => String(f.path).toLowerCase() === String(filePath).toLowerCase());
  if (match && String(match.content || "").trim()) return match;

  const fallback = files[0];
  if (fallback && String(fallback.content || "").trim()) {
    return { path: filePath, content: String(fallback.content || "") };
  }
  throw new Error(`No usable content returned for file: ${filePath}`);
}

async function generateFullStackApp({ description, language }) {
  const userDescription = String(description || "").trim();
  const userLanguage = String(language || "Node.js").trim();
  if (!userDescription) throw new Error("description is required");

  const plan = await generatePlan(userDescription, userLanguage);
  const basePaths = defaultPathsByLanguage(userLanguage);
  let treePaths = [];
  try {
    treePaths = await generateFileTree(plan, userDescription, userLanguage);
  } catch (_err) {
    treePaths = [];
  }

  const selectedPaths = mergeUniquePaths(basePaths, treePaths).slice(0, Math.max(10, ORCHESTRATOR_MAX_FILES));
  const generatedFiles = [];

  for (const filePath of selectedPaths) {
    try {
      const generated = await generateSingleFile(
        filePath,
        plan,
        userDescription,
        userLanguage,
        generatedFiles.map((f) => f.path)
      );
      upsertGeneratedFile(generatedFiles, generated);
    } catch (_err) {
      // Skip failed single files; caller can still validate downstream.
    }
  }

  if (!generatedFiles.length) {
    throw new Error("No files were generated by orchestrator");
  }

  const projectName =
    String(plan?.projectName || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "generated-app";

  return {
    plan,
    projectName,
    files: generatedFiles,
  };
}

module.exports = {
  generatePlan,
  generateFileTree,
  generateSingleFile,
  generateFullStackApp,
};

