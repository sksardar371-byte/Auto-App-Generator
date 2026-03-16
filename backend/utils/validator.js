const { parseJsonSafe } = require("./jsonUtils");

function normalizePath(p) {
  return String(p || "").replace(/\\/g, "/").trim().toLowerCase();
}

function looksLikePlaceholder(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("todo") ||
    t.includes("lorem ipsum") ||
    t.includes("placeholder content") ||
    t.includes("this is a placeholder") ||
    t.includes("your code here") ||
    t.includes("to be implemented") ||
    t.includes("coming soon")
  );
}

function looksLikeMetaDescription(text) {
  const t = String(text || "").toLowerCase().trim();
  return (
    t.startsWith("this file contains") ||
    t.startsWith("the server script") ||
    t.startsWith("a comprehensive guide") ||
    t.startsWith("this is the") ||
    t.includes("for starting up your application") ||
    t.includes("configuration of database")
  );
}

function looksLikeCode(text, ext) {
  const t = String(text || "");
  const lower = t.toLowerCase();
  if (!t.trim()) return false;
  if (ext === ".json") return lower.includes("{") && lower.includes("}");
  // More lenient check for markdown files - just check if it has substantial content
  if (ext === ".md") return t.trim().length >= 10;
  if (ext === ".html") {
    return (
      lower.includes("<html") ||
      lower.includes("<body") ||
      lower.includes("<!doctype") ||
      lower.includes("<head") ||
      lower.includes("<div") ||
      lower.includes("<main") ||
      lower.includes("<section") ||
      lower.includes("<script")
    );
  }
  if (ext === ".css") return lower.includes("{") && lower.includes("}");
  if (ext === ".js") {
    return (
      lower.includes("function ") ||
      lower.includes("=>") ||
      lower.includes("const ") ||
      lower.includes("let ") ||
      lower.includes("import ") ||
      lower.includes("export ") ||
      lower.includes("from ") ||
      lower.includes("createroot(") ||
      lower.includes("reactdom.render(") ||
      lower.includes("document.getelementbyid(") ||
      lower.includes("addEventListener(") ||
      lower.includes("require(") ||
      lower.includes("module.exports") ||
      lower.includes("app.listen(")
    );
  }
  return t.trim().length > 20;
}

function containsBundledFileMarkers(text) {
  const t = String(text || "");
  return /(^|\n)\s*(\/\/|#)?\s*file\s*:/i.test(t);
}

function hasLikelyTruncatedTail(text, ext) {
  const codeLikeExt = [".js", ".jsx", ".ts", ".tsx", ".json", ".html", ".css", ".md"];
  if (!codeLikeExt.includes(ext)) return false;
  const t = String(text || "").trim();
  if (!t) return true;
  if (ext === ".md") {
    // Markdown can legitimately contain code fences; only flag when fences are unbalanced.
    const fenceCount = (t.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) return true;
    return false;
  }
  if (t.includes("```")) return true;
  const tail = t.slice(-140);
  if (/\b(require|import|from|const|let|var|return|module\.exports|export)\s*$/i.test(tail)) return true;
  if (/[({\[]\s*$/.test(t)) return true;
  return false;
}

function sanitizeToken(token) {
  return String(token || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function extractIntentTokens(plan = {}) {
  const sources = [
    plan?.userPrompt || "",
    plan?.stack || "",
    ...(Array.isArray(plan?.pages) ? plan.pages : []),
    ...(Array.isArray(plan?.routes) ? plan.routes : []),
    ...(Array.isArray(plan?.entities) ? plan.entities : []),
    ...(Array.isArray(plan?.notes) ? plan.notes : []),
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");

  const stopwords = new Set([
    "build", "create", "make", "app", "application", "website", "web", "site", "project",
    "using", "with", "from", "for", "that", "this", "these", "those", "into", "onto",
    "the", "and", "or", "then", "than", "your", "you", "our", "their", "should", "must",
    "need", "needs", "required", "full", "complete", "simple", "basic", "modern", "clean",
    "fully", "working", "where", "plain", "hard", "requirements", "requirement",
    "responsive", "frontend", "backend", "client", "server", "code", "files", "feature",
    "features", "system", "platform", "tool", "support", "supports", "include", "includes",
    "implement", "implements", "api", "apis", "ui", "ux", "page", "pages", "route", "routes",
    "data", "model", "models", "table", "tables", "proper", "stack"
  ]);

  const preferred = new Set([
    "auth", "login", "signup", "register", "jwt", "token",
    "dashboard", "admin", "ecommerce", "cart", "checkout", "payment",
    "blog", "post", "comment", "chat", "message", "booking", "appointment",
    "hotel", "clinic", "portfolio", "snake", "chess", "todo", "task", "crm",
    "inventory", "invoice", "report", "analytics", "search", "filter", "upload"
  ]);

  const rawTokens = sources
    .replace(/[^a-z0-9]+/gi, " ")
    .split(/\s+/)
    .map(sanitizeToken)
    .filter(Boolean);
  const selected = [];
  for (const token of rawTokens) {
    if (token.length < 4) continue;
    if (stopwords.has(token)) continue;
    if (selected.includes(token)) continue;
    if (preferred.has(token) || selected.length < 10) {
      selected.push(token);
    }
    if (selected.length >= 12) break;
  }
  return selected;
}

function tokenPatterns(token) {
  const aliases = {
    mern: ["mern", "mongodb", "mongoose", "express", "react", "node", "nodejs"],
    mongodb: ["mongodb", "mongo", "mongoose"],
    reactjs: ["react", "reactjs", "jsx", "vite"],
    nodejs: ["node", "nodejs", "express", "api"],
    home: ["home", "/home", "index", "landing", "route"],
    profile: ["profile", "/profile", "user", "account"],
    auth: ["auth", "login", "signin", "signup", "jwt", "token"],
    login: ["login", "signin", "authenticate", "auth"],
    signup: ["signup", "register", "createaccount"],
    register: ["register", "registration", "signup"],
    ecommerce: ["ecommerce", "store", "shop", "product", "cart", "checkout"],
    cart: ["cart", "basket", "addtocart"],
    checkout: ["checkout", "payment", "order"],
    payment: ["payment", "stripe", "razorpay", "paypal", "checkout"],
    blog: ["blog", "post", "article"],
    chat: ["chat", "message", "socket", "conversation"],
    booking: ["booking", "reservation", "appointment"],
    appointment: ["appointment", "schedule", "slot", "calendar"],
    dashboard: ["dashboard", "stats", "analytics", "report"],
    snake: ["snake", "canvas", "keydown", "game"],
    chess: ["chess", "board", "piece", "game"],
    todo: ["todo", "task", "checklist"],
    inventory: ["inventory", "stock", "product"],
    invoice: ["invoice", "billing", "payment"],
    search: ["search", "query", "filter"],
    upload: ["upload", "multipart", "file"],
  };

  if (aliases[token]) return aliases[token];
  if (token.endsWith("s") && token.length > 4) return [token, token.slice(0, -1)];
  return [token];
}

function hasLowEffortTemplate(normalizedPaths, contentByPath) {
  const jsFiles = normalizedPaths.filter((p) => p.endsWith(".js"));
  const htmlFiles = normalizedPaths.filter((p) => p.endsWith(".html"));
  const nonDocFiles = normalizedPaths.filter((p) => !p.endsWith(".md"));
  const allContent = normalizedPaths.map((p) => String(contentByPath.get(p) || "")).join("\n").toLowerCase();
  const hasHelloWorld = allContent.includes("hello world");
  const hasOnlyTinyStructure = nonDocFiles.length <= 4 && jsFiles.length <= 2 && htmlFiles.length <= 1;
  return hasHelloWorld && hasOnlyTinyStructure;
}

function extractHtmlAssetRefs(html) {
  const text = String(html || "");
  const refs = { scripts: [], styles: [] };
  const scriptRegex = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  const styleRegex = /<link[^>]*\srel=["']stylesheet["'][^>]*\shref=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = scriptRegex.exec(text)) !== null) refs.scripts.push(String(m[1] || "").trim());
  while ((m = styleRegex.exec(text)) !== null) refs.styles.push(String(m[1] || "").trim());
  return refs;
}

function resolveWebAssetPath(htmlPath, refPath) {
  const cleaned = String(refPath || "").trim().replace(/^\.?\//, "");
  if (!cleaned || /^https?:\/\//i.test(cleaned) || cleaned.startsWith("//")) return "";
  const baseDir = dirnamePosix(htmlPath);
  const joined = baseDir ? `${baseDir}/${cleaned}` : cleaned;
  return normalizePathSegments(joined);
}

function stripJsComments(source) {
  const text = String(source || "");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function getLocalImportSpecifiers(source) {
  const text = stripJsComments(source);
  const found = new Set();
  const requireRegex = /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  const importRegex = /\bimport\s+[^'"]*from\s+["'](\.{1,2}\/[^"']+)["']/g;
  const dynamicImportRegex = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

  for (const rx of [requireRegex, importRegex, dynamicImportRegex]) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return Array.from(found);
}

function dirnamePosix(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/");
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

function normalizePathSegments(pathValue) {
  const parts = String(pathValue || "").split("/");
  const stack = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function resolveLocalSpecifier(fromPath, specifier) {
  const baseDir = dirnamePosix(fromPath);
  const joined = baseDir ? `${baseDir}/${specifier}` : specifier;
  return normalizePathSegments(joined);
}

function candidateModulePaths(resolvedNoExt) {
  const base = normalizePath(resolvedNoExt);
  return [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mjs`,
    `${base}/index.cjs`,
  ];
}

function validateGeneratedPayload(payload, plan = {}) {
  const issues = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, issues: ["Payload is not an object"] };
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) {
    return { ok: false, issues: ["No files generated"] };
  }

  const seen = new Set();
  const contentByPath = new Map();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || !file.path.trim()) {
      issues.push("Invalid file path in payload");
      continue;
    }
    if (typeof file.content !== "string") {
      issues.push(`Non-string content for ${file.path}`);
      continue;
    }
    const np = normalizePath(file.path);
    if (np.startsWith("/") || np.includes(":")) issues.push(`Absolute path not allowed: ${file.path}`);
    if (seen.has(np)) issues.push(`Duplicate path: ${file.path}`);
    seen.add(np);
    contentByPath.set(np, file.content);
    if (file.content.trim().length < 10) issues.push(`Too short content: ${file.path}`);
    if (looksLikePlaceholder(file.content)) issues.push(`Placeholder content detected: ${file.path}`);
    if (looksLikeMetaDescription(file.content)) issues.push(`Non-code descriptive content: ${file.path}`);
    const ext = np.includes(".") ? np.slice(np.lastIndexOf(".")) : "";
    if (containsBundledFileMarkers(file.content)) issues.push(`Bundled multi-file text detected in ${file.path}`);
    if (hasLikelyTruncatedTail(file.content, ext)) issues.push(`Likely truncated/incomplete file content: ${file.path}`);
    if (!looksLikeCode(file.content, ext)) issues.push(`File does not look like runnable content: ${file.path}`);
  }

  const stack = String(plan?.stack || "").toLowerCase();
  const isWeb = stack.includes("html") || stack.includes("static");
  const normalized = Array.from(seen);

  const hasReadme = normalized.includes("readme.md");
  if (!hasReadme) issues.push("Missing README.md");

  const hasPackage = normalized.some((p) => p === "package.json" || p.endsWith("/package.json"));
  const hasAnyHtml = normalized.some((p) => p.endsWith(".html"));
  const hasReactEntry = normalized.some((p) =>
    p.endsWith("/src/main.jsx") ||
    p.endsWith("/src/main.js") ||
    p.endsWith("/src/app.jsx") ||
    p.endsWith("/src/app.js")
  );
  const hasNodeServerEntry = normalized.some((p) =>
    ["server.js", "src/server.js", "app.js", "index.js"].includes(p) ||
    p.endsWith("/server.js") ||
    p.endsWith("/app.js") ||
    p.endsWith("/index.js")
  );
  const needsPackage = !isWeb && (hasNodeServerEntry || hasReactEntry || !hasAnyHtml);
  if (needsPackage && !hasPackage) issues.push("Missing package.json for app stack");

  const hasServer = normalized.some((p) =>
    ["server.js", "src/server.js", "app.js", "index.js"].includes(p) ||
    p.endsWith("/server.js") ||
    p.endsWith("/app.js") ||
    p.endsWith("/index.js")
  );
  const hasHtmlEntry = normalized.some((p) => p.endsWith(".html"));
  const hasFrontendEntry = normalized.some((p) =>
    p.endsWith("/src/main.jsx") ||
    p.endsWith("/src/main.js") ||
    p.endsWith("/src/app.jsx") ||
    p.endsWith("/src/app.js")
  );
  if (!hasServer && !hasHtmlEntry && !hasFrontendEntry) {
    issues.push("Missing server entry or HTML entry file");
  }

  // Static frontend quality gate: ensure HTML/CSS/JS wiring exists and JS is behavioral.
  if (hasHtmlEntry) {
    const indexHtmlPath =
      normalized.find((p) => p === "index.html" || p.endsWith("/index.html")) ||
      normalized.find((p) => p.endsWith(".html"));
    const hasStyleFile = normalized.some((p) => p === "style.css" || p.endsWith("/style.css"));
    const hasScriptFile = normalized.some((p) => p === "script.js" || p.endsWith("/script.js"));
    if (!hasStyleFile) issues.push("Missing style.css for static frontend");
    if (!hasScriptFile) issues.push("Missing script.js for static frontend");

    if (indexHtmlPath) {
      const html = String(contentByPath.get(indexHtmlPath) || "");
      const refs = extractHtmlAssetRefs(html);
      const styleLinked = refs.styles.some((href) => {
        const resolved = normalizePath(resolveWebAssetPath(indexHtmlPath, href));
        return resolved && seen.has(resolved);
      });
      const scriptLinked = refs.scripts.some((src) => {
        const resolved = normalizePath(resolveWebAssetPath(indexHtmlPath, src));
        return resolved && seen.has(resolved);
      });
      if (!styleLinked && hasStyleFile) issues.push(`${indexHtmlPath} does not link generated CSS file`);
      if (!scriptLinked && hasScriptFile) issues.push(`${indexHtmlPath} does not link generated JS file`);
    }

    const jsFiles = normalized.filter((p) => p.endsWith(".js"));
    if (jsFiles.length) {
      const hasBehaviorInAnyJs = jsFiles.some((jsPath) => {
        const script = String(contentByPath.get(jsPath) || "").toLowerCase();
        return (
          script.includes("addeventlistener(") ||
          script.includes("onclick") ||
          script.includes("onsubmit") ||
          script.includes("fetch(") ||
          script.includes("axios.") ||
          script.includes("queryselector(") ||
          script.includes("getelementbyid(")
        );
      });
      if (!hasBehaviorInAnyJs) {
        issues.push("Frontend JS looks non-functional (no event/API/DOM behavior detected)");
      }
    }
  }

  for (const sourcePath of normalized.filter((p) => /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(p))) {
    const source = String(contentByPath.get(sourcePath) || "");
    for (const specifier of getLocalImportSpecifiers(source)) {
      const resolved = resolveLocalSpecifier(sourcePath, specifier);
      const candidates = candidateModulePaths(resolved);
      const exists = candidates.some((candidate) => seen.has(normalizePath(candidate)));
      if (!exists) {
        issues.push(`Missing local module for import '${specifier}' referenced in ${sourcePath}`);
      }
    }
  }

  const packagePath = normalized.find((p) => p === "package.json" || p.endsWith("/package.json"));
  if (packagePath) {
    try {
      const pkg = parseJsonSafe(String(contentByPath.get(packagePath) || "{}"));
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
        throw new Error("invalid package object");
      }
      if (!pkg.name) issues.push("package.json missing name");
      if (!pkg.scripts || (!pkg.scripts.start && !pkg.scripts.dev)) {
        issues.push("package.json missing start/dev script");
      }
    } catch (_) {
      issues.push("package.json is not valid JSON");
    }
  }

  const frontendPackagePath = normalized.find((p) => p === "frontend/package.json" || p.endsWith("/frontend/package.json"));
  const hasReactSource = normalized.some((p) => p.startsWith("frontend/src/")) ||
    normalized.some((p) => /reactdom\.render\(|createroot\(|from\s+["']react["']/i.test(String(contentByPath.get(p) || "")));
  if (hasReactSource && !frontendPackagePath) {
    issues.push("Missing frontend/package.json for React frontend");
  }
  if (frontendPackagePath) {
    try {
      const fpkg = parseJsonSafe(String(contentByPath.get(frontendPackagePath) || "{}"));
      const scripts = fpkg?.scripts || {};
      const deps = { ...(fpkg?.dependencies || {}), ...(fpkg?.devDependencies || {}) };
      const hasFrontendStart = typeof scripts.start === "string" && scripts.start.trim().length > 0;
      const hasFrontendTooling = Boolean(deps["react-scripts"] || deps["vite"] || deps["@vitejs/plugin-react"]);
      if (!hasFrontendStart) issues.push("frontend/package.json missing start script");
      if (hasReactSource && !hasFrontendTooling) issues.push("frontend/package.json missing React build tooling (react-scripts or vite)");
    } catch (_) {
      issues.push("frontend/package.json is not valid JSON");
    }
  }

  const serverCandidates = normalized.filter((p) =>
    ["server.js", "src/server.js", "app.js", "index.js", "backend/server.js", "backend/app.js", "backend/index.js"].includes(p) ||
    p.endsWith("/server.js") ||
    p.endsWith("/app.js") ||
    p.endsWith("/backend/server.js") ||
    p.endsWith("/backend/app.js")
  );
  if (serverCandidates.length) {
    const pickedServerPath =
      serverCandidates.find((candidate) => {
        const t = String(contentByPath.get(candidate) || "").toLowerCase();
        return t.includes("express(") || t.includes("http.createserver") || t.includes("fastify(") || t.includes("koa(");
      }) ||
      serverCandidates.find((candidate) => /(^|\/)(backend|api)\//.test(candidate)) ||
      serverCandidates.find((candidate) => candidate.endsWith("/server.js") || candidate === "server.js") ||
      serverCandidates[0];

    const serverContent = String(contentByPath.get(pickedServerPath) || "").toLowerCase();
    const startsHttpServer =
      serverContent.includes(".listen(") ||
      serverContent.includes("createServer(") ||
      serverContent.includes("app.listen(") ||
      serverContent.includes("server.listen(");

    // Only enforce when file actually looks like backend/server bootstrap.
    const looksLikeBackendBootstrap =
      serverContent.includes("express(") ||
      serverContent.includes("fastify(") ||
      serverContent.includes("koa(") ||
      serverContent.includes("createServer(");

    if (looksLikeBackendBootstrap && !startsHttpServer) {
      issues.push("Server entry does not start an HTTP server");
    }
  }

  if (hasLowEffortTemplate(normalized, contentByPath)) {
    issues.push("Low-effort template output detected (hello-world style scaffold)");
  }

  const intentTokens = extractIntentTokens(plan);
  if (intentTokens.length > 0) {
    const codePaths = normalized.filter((p) => !p.endsWith(".md"));
    const codeText = codePaths
      .map((p) => `${p}\n${String(contentByPath.get(p) || "")}`)
      .join("\n")
      .toLowerCase();

    const uncovered = intentTokens.filter((token) => {
      const patterns = tokenPatterns(token);
      return !patterns.some((pattern) => codeText.includes(pattern));
    });

    const maxMissing = Math.max(1, Math.floor(intentTokens.length * 0.5));
    if (uncovered.length > maxMissing) {
      issues.push(
        `Generated code does not cover requested features sufficiently: missing intents [${uncovered.slice(0, 8).join(", ")}]`
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

module.exports = {
  validateGeneratedPayload,
};
