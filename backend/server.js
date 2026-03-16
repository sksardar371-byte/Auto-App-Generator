const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const OpenAI = require("openai");

// Routes
const authRoutes = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const ordersRoutes = require("./routes/orders");
const inventoryRoutes = require("./routes/inventory");
const dashboardRoutes = require("./routes/dashboard");
const aiRoutes = require("./routes/ai");
const generatorRoutes = require("./routes/generate");

const app = express();

// ---------------------------
// ✅ CORS Setup (global)
// ---------------------------
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
      "http://localhost:3001",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// ---------------------------
// ✅ JSON and URL-encoded body parser
// ---------------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------------------------
// ✅ Ensure folders exist
// ---------------------------
const GENERATED_FOLDER = path.resolve(
  String(process.env.GENERATED_PROJECTS_DIR || path.join(__dirname, "generated_projects"))
);
const UPLOAD_FOLDER = path.resolve(
  String(process.env.UPLOADS_DIR || path.join(__dirname, "uploads"))
);
const PREVIEW_FOLDER = path.resolve(
  String(process.env.PREVIEW_PROJECTS_DIR || path.join(__dirname, "preview_projects"))
);

[GENERATED_FOLDER, UPLOAD_FOLDER, PREVIEW_FOLDER].forEach((folder) => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
});

function normalizeGeneratedPageName(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned === "signin" || cleaned === "sign-in") return "login";
  if (cleaned === "signup" || cleaned === "sign-up") return "register";
  if (cleaned === "project-list" || cleaned === "projectlist") return "projects";
  if (cleaned === "project-detail" || cleaned === "projectdetail") return "project-detail";
  if (cleaned === "home") return "index";
  return cleaned;
}

function isWeakGeneratedPage(pageName, html) {
  const page = normalizeGeneratedPageName(pageName);
  const text = String(html || "");
  const lower = text.toLowerCase();
  if (!lower.trim()) return true;
  if (lower.includes("this page was auto-generated because it was linked from navigation")) return true;
  if (lower.includes("<h1>generated page</h1>")) return true;
  if (lower.includes("project shell created to complete build plan")) return true;
  if (lower.includes("welcome to your generated application")) return true;
  if (lower.includes("application is ready!")) return true;
  if (page === "login") return !/id=["']loginForm["']/i.test(text);
  if (page === "register") return !/id=["']registerForm["']/i.test(text);
  if (page === "dashboard") {
    const hasLegacyList = /id=["']project-list["']/i.test(text) || /id=["']projectsList["']/i.test(text);
    const hasAnyForm = /<form[\s>]/i.test(text);
    const hasEntityList = /id=["'][^"']*(list-|list|items|cards|grid|table|results)[^"']*["']/i.test(text);
    const hasReqEntity = /data-entity=/i.test(text) || /req-form/i.test(text);
    return !hasLegacyList && !hasAnyForm && !hasEntityList && !hasReqEntity;
  }
  if (page === "projects") return !/id=["']projectsList["']/i.test(text) && !/id=["']project-list["']/i.test(text);
  if (page === "settings") return !/id=["']themeSelect["']/i.test(text);
  if (page === "order-tracking" || page === "tracking" || page === "ordertracking") {
    const hasTrackingMeta = /id=["'][^"']*trackingmeta[^"']*["']/i.test(lower) || /order\s*tracking/i.test(lower);
    const hasTimeline =
      /id=["'][^"']*(trackingtimeline|timeline|steps|status)[^"']*["']/i.test(lower) ||
      /class=["'][^"']*timeline[^"']*["']/i.test(lower);
    const hasScript = /<script[^>]+src=["'][^"']+\.js["']/i.test(text);
    return !(hasTrackingMeta && hasTimeline && hasScript);
  }
  if (page && page !== "index") {
    const hasFeatureRoot = /data-feature-root=/i.test(text);
    const hasListRegion = /id=["'][^"']*(list|items|table|cards|grid|results|timeline|tracking|steps|status)[^"']*["']/i.test(text);
    const hasActionButton =
      /<button[^>]+id=["'][^"']*(add|create|save|submit|open|view|search|track|advance|checkout|place|order)[^"']*["']/i.test(text) ||
      /<button[^>]+data-add-item/i.test(text);
    const hasForm = /<form[\s>]/i.test(text);
    const hasPageScript = /<script[^>]+src=["'][^"']+\.js["']/i.test(text);
    const hasInteractiveUi = /class=["'][^"']*(timeline|panel|card|kpi|quick-grid|menu-grid|floating-cart)[^"']*["']/i.test(text);
    const weakByLength = lower.replace(/\s+/g, "").length < 500;
    if (!hasFeatureRoot && !hasListRegion && !hasActionButton && !hasForm && !hasInteractiveUi) return true;
    if (!hasPageScript) return true;
    if (weakByLength && !hasInteractiveUi) return true;
  }
  return false;
}

function buildGeneratedPageTemplate(pageName, appTitle = "Generated App") {
  const page = normalizeGeneratedPageName(pageName);
  const safeTitle = String(appTitle || "Generated App").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 80);

  if (page === "index") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:980px;margin:40px auto;padding:24px;"><header style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><h1 style="margin:0;">${safeTitle}</h1><nav style="display:flex;gap:10px;flex-wrap:wrap;"><a href="login.html">Login</a><a href="register.html">Register</a><a href="dashboard.html">Dashboard</a></nav></header><section style="margin-top:18px;"><h2 style="margin:0 0 8px;">Welcome</h2><p style="margin:0;color:#4b5563;">Start by creating an account or signing in. This app uses live API data and does not depend on placeholder records.</p></section></main><script src="script.js"></script></body></html>`;
  }
  if (page === "login") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Login | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:460px;margin:40px auto;padding:24px;"><h1>Login</h1><form id="loginForm"><label>Email</label><input type="email" name="email" required><label>Password</label><input type="password" name="password" required><button type="submit">Sign In</button></form><p><a href="register.html">Create account</a> | <a href="index.html">Back Home</a></p></main><script src="script.js"></script><script src="login.js"></script></body></html>`;
  }
  if (page === "register") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Register | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:520px;margin:40px auto;padding:24px;"><h1>Create Account</h1><form id="registerForm"><label>Full Name</label><input type="text" name="name" required><label>Email</label><input type="email" name="email" required><label>Password</label><input type="password" name="password" required><button type="submit">Register</button></form><p><a href="login.html">Already have an account?</a> | <a href="index.html">Back Home</a></p></main><script src="script.js"></script><script src="register.js"></script></body></html>`;
  }
  if (page === "dashboard") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dashboard | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main class="shell"><section class="card"><header class="row"><h1>Dashboard</h1><button id="logoutBtn" class="btn secondary" type="button">Logout</button></header><p id="roleAccessNote"></p><form id="dashboardFeatureForm"><label>Name</label><input name="name" required /><label>Status</label><input name="status" /><label>Description</label><textarea name="description"></textarea><button type="submit">Save</button></form><section id="project-list"></section><p><a href="index.html">Back Home</a></p></section></main><script src="script.js"></script><script src="dashboard.js"></script></body></html>`;
  }
  if (page === "projects") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Projects | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:960px;margin:40px auto;padding:24px;"><h1>Projects</h1><section id="projectsList"></section><p style="margin-top:16px;"><a href="dashboard.html">Go to Dashboard</a> | <a href="index.html">Back Home</a></p></main><script src="script.js"></script><script src="projectlist.js"></script></body></html>`;
  }
  if (page === "settings") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Settings | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:760px;margin:40px auto;padding:24px;"><h1>Settings</h1><label for="themeSelect">Theme</label><select id="themeSelect"><option value="dark">Dark</option><option value="light">Light</option></select><button id="saveSettingsBtn" type="button">Save Settings</button><p style="margin-top:16px;"><a href="dashboard.html">Back to Dashboard</a></p></main><script src="script.js"></script><script src="settings.js"></script></body></html>`;
  }
  if (page === "order-tracking" || page === "tracking" || page === "ordertracking") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Order Tracking | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:900px;margin:32px auto;padding:24px;"><header style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><h1 style="margin:0;">Order Tracking</h1><a href="index.html">Back Home</a></header><p id="trackingMeta" style="color:#4b5563;margin-top:12px;">Loading current order...</p><button id="advanceStatusBtn" type="button" style="margin:8px 0 12px;">Advance Status</button><ul id="trackingTimeline" style="display:grid;gap:8px;padding-left:18px;"><li>Order Confirmed</li><li>Restaurant Preparing</li><li>Picked Up by Delivery Partner</li><li>On the Way</li><li>Delivered</li></ul></main><script src="script.js"></script></body></html>`;
  }

  const safePage = String(page || "feature").replace(/[^a-z0-9_-]/g, "");
  const title = safePage.charAt(0).toUpperCase() + safePage.slice(1);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} | ${safeTitle}</title><link rel="stylesheet" href="style.css"></head><body><main style="max-width:980px;margin:40px auto;padding:24px;"><header style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><h1>${title}</h1><a href="index.html">Back Home</a></header><p>This page is ready for live data integration.</p><section id="${safePage}-list" style="margin-top:16px;padding:12px;border:1px solid #d7dce7;border-radius:10px;background:#fff;"><p style="margin:0;color:#5b6475;">No records yet. Use this page actions to create and load real data from the API.</p></section></main><script src="script.js"></script><script src="${safePage}.js"></script></body></html>`;
}

// Fallback for generated frontend pages that were linked but not created.
app.get("/generated_projects/:projectName/frontend/:page", (req, res, next) => {
  const page = String(req.params.page || "");
  if (!page.toLowerCase().endsWith(".html")) return next();

  const projectName = String(req.params.projectName || "");
  const requestedPath = path.join(GENERATED_FOLDER, projectName, "frontend", page);
  const indexPath = path.join(GENERATED_FOLDER, projectName, "frontend", "index.html");
  const appTitle = fs.existsSync(indexPath)
    ? (String(fs.readFileSync(indexPath, "utf8")).match(/<title>([^<]+)<\/title>/i)?.[1] || "Generated App")
    : "Generated App";
  const pageName = normalizeGeneratedPageName(path.basename(page, ".html"));

  if (fs.existsSync(requestedPath)) {
    try {
      const currentHtml = fs.readFileSync(requestedPath, "utf8");
      if (isWeakGeneratedPage(pageName, currentHtml)) {
        const upgraded = buildGeneratedPageTemplate(pageName, appTitle);
        if (upgraded) {
          return res.type("html").send(upgraded);
        }
      }
    } catch (_err) {
      // Fallback to static file if read fails.
    }
    return res.sendFile(requestedPath);
  }

  const fallbackPage = buildGeneratedPageTemplate(pageName, appTitle);
  if (fallbackPage) return res.type("html").send(fallbackPage);
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("Generated frontend page not found");
});

// Fallback for generated public pages that were linked but not created.
app.get("/generated_projects/:projectName/public/:page", (req, res, next) => {
  const page = String(req.params.page || "");
  if (!page.toLowerCase().endsWith(".html")) return next();

  const projectName = String(req.params.projectName || "");
  const requestedPath = path.join(GENERATED_FOLDER, projectName, "public", page);
  const indexPath = path.join(GENERATED_FOLDER, projectName, "public", "index.html");
  const appTitle = fs.existsSync(indexPath)
    ? (String(fs.readFileSync(indexPath, "utf8")).match(/<title>([^<]+)<\/title>/i)?.[1] || "Generated App")
    : "Generated App";
  const pageName = normalizeGeneratedPageName(path.basename(page, ".html"));

  if (fs.existsSync(requestedPath)) {
    try {
      const currentHtml = fs.readFileSync(requestedPath, "utf8");
      if (isWeakGeneratedPage(pageName, currentHtml)) {
        const upgraded = buildGeneratedPageTemplate(pageName, appTitle);
        if (upgraded) {
          return res.type("html").send(upgraded);
        }
      }
    } catch (_err) {
      // Fallback to static file if read fails.
    }
    return res.sendFile(requestedPath);
  }

  const fallbackPage = buildGeneratedPageTemplate(pageName, appTitle);
  if (fallbackPage) return res.type("html").send(fallbackPage);
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("Generated public page not found");
});

// ---------------------------
// ✅ Serve static folders
// ---------------------------
app.use("/generated_projects", express.static(GENERATED_FOLDER));
app.use("/preview_projects", express.static(PREVIEW_FOLDER));
app.use("/uploads", express.static(UPLOAD_FOLDER));
app.use("/ai_generated", express.static(path.join(__dirname, "ai_generated")));

// ---------------------------
// ✅ API Routes
// ---------------------------
app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ai", aiRoutes);
app.post("/api/generate", (req, res, next) => {
  req.url = "/";
  return generatorRoutes(req, res, next);
});
app.post("/api/generator/generate", (req, res, next) => {
  req.url = "/";
  return generatorRoutes(req, res, next);
});
app.use("/api/generator", generatorRoutes);
app.get("/api/health", (_req, res) => {
  res.json({ success: true, service: "auto-app-generator-backend" });
});
app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, message: "API route not found" });
});

// ---------------------------
// ✅ Root endpoint
// ---------------------------
app.get("/", (req, res) => {
  res.send("🚀 Auto App Generator Backend is running...");
});

// ---------------------------
// ✅ Start Server
// ---------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Express server running on http://localhost:${PORT}`);
});
