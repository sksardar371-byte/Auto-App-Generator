const express = require("express");
const router = express.Router();
const mysql = require("mysql2");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const unzipper = require("unzipper");
const jwt = require("jsonwebtoken");

// ---------------------------
// MySQL Connection
// ---------------------------
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "1234",
  database: "autoapp",
});

// ---------------------------
// Local JSON store for generated-app preview compatibility
// ---------------------------
const COMPAT_DATA_DIR = path.join(__dirname, "../data");
const COMPAT_DB_FILE = path.join(COMPAT_DATA_DIR, "generated-projects.json");
if (!fs.existsSync(COMPAT_DATA_DIR)) fs.mkdirSync(COMPAT_DATA_DIR, { recursive: true });
if (!fs.existsSync(COMPAT_DB_FILE)) {
  fs.writeFileSync(COMPAT_DB_FILE, JSON.stringify({ records: [] }, null, 2), "utf8");
}

function readCompatStore() {
  try {
    const raw = fs.readFileSync(COMPAT_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (_err) {
    return [];
  }
}

function writeCompatStore(records) {
  fs.writeFileSync(COMPAT_DB_FILE, JSON.stringify({ records: records || [] }, null, 2), "utf8");
}

function normalizeProjectKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 120);
}

function normalizeCompatRole(input) {
  const raw = String(input || "").trim().toLowerCase().replace(/-/g, "_");
  if (!raw || raw === "user" || raw === "customer" || raw === "student") return "patient";
  if (raw === "instructor" || raw === "teacher") return "doctor";
  if (raw === "labtechnician") return "lab_technician";
  return raw;
}

function getEntityAliases(entityType) {
  const key = String(entityType || "").trim().toLowerCase();
  const aliases = {
    appointment: ["appointment", "course"],
    booking: ["booking", "enrollment"],
    care_note: ["care_note", "discussion_post"],
    lab_report_request: ["lab_report_request", "certificate_request"],
    billing: ["billing", "payment"],
  };
  return aliases[key] || [key];
}

function extractProjectKeyFromUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, "http://localhost");
    const fromQuery = normalizeProjectKey(parsed.searchParams.get("projectKey"));
    if (fromQuery) return fromQuery;
    const pathname = String(parsed.pathname || "").replace(/\\/g, "/");
    const match =
      pathname.match(/\/generated_projects\/([^/]+)\//i) ||
      pathname.match(/\/preview_projects\/([^/]+)\//i);
    return normalizeProjectKey(match?.[1] || "");
  } catch (_err) {
    const queryMatch = value.match(/[?&]projectKey=([^&#]+)/i);
    if (queryMatch?.[1]) {
      let decoded = String(queryMatch[1] || "");
      try {
        decoded = decodeURIComponent(decoded);
      } catch (_decodeErr) {
        // keep raw token when URI decoding fails
      }
      return normalizeProjectKey(decoded);
    }
    const pathOnly = value.replace(/\\/g, "/");
    const match =
      pathOnly.match(/\/generated_projects\/([^/]+)\//i) ||
      pathOnly.match(/\/preview_projects\/([^/]+)\//i);
    return normalizeProjectKey(match?.[1] || "");
  }
}

function extractProjectKeyFromReferer(req) {
  const referer = String(req.headers.referer || req.headers.referrer || "");
  return extractProjectKeyFromUrl(referer);
}

function resolveProjectKey(req) {
  return (
    normalizeProjectKey(req.query?.projectKey) ||
    extractProjectKeyFromReferer(req) ||
    normalizeProjectKey(req.body?.projectKey) ||
    normalizeProjectKey(req.headers["x-project-key"]) ||
    extractProjectKeyFromUrl(req.headers.origin)
  );
}

function resolveAuthFromToken(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    const userId = String(decoded?.sub || decoded?.id || decoded?.email || "");
    if (!userId) return null;
    const role = normalizeCompatRole(decoded?.role);
    return { userId, role, hasRole: Boolean(role) };
  } catch (_err) {
    return null;
  }
}

function requireCompatAuth(req, res, next) {
  const authCtx = resolveAuthFromToken(req);
  if (!authCtx?.userId) {
    return res.status(401).json({ success: false, message: "Missing or invalid token" });
  }
  req.compatUserId = authCtx.userId;
  req.compatRole = authCtx.role || "";
  req.compatHasRole = Boolean(authCtx.hasRole);
  req.compatProjectKey = resolveProjectKey(req);
  next();
}

function canWriteEntity(entityType, role, hasRole) {
  // Backward-compatible mode: if role claim not present in token, allow writes.
  if (!hasRole) return true;
  const normalizedRole = normalizeCompatRole(role);
  if (normalizedRole === "admin") return true;
  const type = String(entityType || "").toLowerCase();
  if (normalizedRole === "doctor") {
    return /(appointment|booking|request|patient|prescription|medicine|lab|report|consultation|note|record|enrol|enroll|course)/.test(type);
  }
  if (normalizedRole === "patient") {
    return /(appointment|booking|request|enrol|enroll|discussion|comment|post|care_note|profile)/.test(type);
  }
  if (normalizedRole === "delivery" || normalizedRole === "delivery_agent") {
    return /(deliver|shipment|tracking|order)/.test(type);
  }
  if (normalizedRole === "receptionist") {
    return /(patient|appointment|booking|request)/.test(type);
  }
  if (normalizedRole === "pharmacist") {
    return /(prescription|medicine|inventory|pharmacy|billing|request|patient)/.test(type);
  }
  if (normalizedRole === "lab_technician" || normalizedRole === "lab-technician") {
    return /(lab|report|test|appointment|patient|request)/.test(type);
  }
  return false;
}

function canReadCompatRow(req, row) {
  const role = normalizeCompatRole(req.compatRole);
  if (role === "admin") return true;
  const entityType = String(row?.data?.entityType || "").toLowerCase();
  if (role === "doctor" && /(patient|appointment|booking|prescription|lab|report|request|medicine|enrol|enroll|course)/.test(entityType)) {
    return true;
  }
  if (role === "receptionist" && /(patient|appointment|booking|request)/.test(entityType)) {
    return true;
  }
  if ((role === "pharmacist") && /(prescription|medicine|inventory|pharmacy|billing|patient)/.test(entityType)) {
    return true;
  }
  if ((role === "lab_technician" || role === "lab-technician") && /(lab|report|test|appointment|patient|request)/.test(entityType)) {
    return true;
  }
  if (role === "patient" && /(appointment|booking|prescription|report|lab|request|enrol|enroll|course)/.test(entityType)) {
    return true;
  }
  const ownedByCurrentUser = String(row?.userId || "") === String(req.compatUserId || "");
  const isShared =
    String(row?.visibility || "").toLowerCase() === "public" ||
    String(row?.data?.visibility || "").toLowerCase() === "public";
  const createdByAdmin =
    String(row?.createdByRole || "").toLowerCase() === "admin" ||
    String(row?.ownerRole || "").toLowerCase() === "admin" ||
    String(row?.data?.createdByRole || "").toLowerCase() === "admin";
  const updatedByAdmin =
    String(row?.updatedByRole || "").toLowerCase() === "admin" ||
    String(row?.data?.updatedByRole || "").toLowerCase() === "admin";
  return ownedByCurrentUser || isShared || createdByAdmin || updatedByAdmin;
}

// ---------------------------
// Compatibility routes for generated dashboards:
// GET /api/projects
// POST /api/projects
// ---------------------------
router.get("/", requireCompatAuth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase().trim();
  const status = String(req.query.status || "").toLowerCase().trim();
  const entity = String(req.query.entityType || "").toLowerCase().trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 100)));
  if (!req.compatProjectKey) {
    return res.json({
      success: true,
      projects: [],
      total: 0,
      page,
      limit,
      message: "Missing project context",
    });
  }

  let rows = readCompatStore();
  rows = rows.filter((x) => normalizeProjectKey(x?.projectKey) === req.compatProjectKey);
  rows = rows.filter((x) => canReadCompatRow(req, x));
  if (entity) {
    const aliases = new Set(getEntityAliases(entity));
    rows = rows.filter((x) => aliases.has(String(x?.data?.entityType || "").toLowerCase()));
  }
  if (status) rows = rows.filter((x) => String(x?.status || "").toLowerCase() === status);
  if (q) {
    rows = rows.filter((x) => {
      const text = [x.name, x.description, JSON.stringify(x.data || {})].join(" ").toLowerCase();
      return text.includes(q);
    });
  }
  rows.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const total = rows.length;
  const start = (page - 1) * limit;
  const paged = rows.slice(start, start + limit);
  return res.json({ success: true, projects: paged, total, page, limit });
});

router.post("/", requireCompatAuth, (req, res) => {
  const body = req.body || {};
  const role = String(req.compatRole || "").toLowerCase();
  if (!req.compatProjectKey) {
    return res.status(400).json({ success: false, message: "Missing project context" });
  }
  const name =
    body.name ||
    body.title ||
    body.workoutType ||
    body.productName ||
    body.patientName ||
    body.studentName ||
    body.leadName;
  if (!name) {
    return res.status(400).json({ success: false, message: "A primary name field is required" });
  }

  const entityType = String(body.entityType || "record").toLowerCase();
  if (!canWriteEntity(entityType, req.compatRole, req.compatHasRole)) {
    return res.status(403).json({ success: false, message: "Only admin can modify this module" });
  }

  const records = readCompatStore();
  const visibility = String(body.visibility || (role === "admin" ? "public" : "private")).toLowerCase();
  const data = { ...body, visibility, createdByRole: role || "user" };
  if (/(enrol|enroll|booking)/.test(entityType)) {
    data.courseKey = normalizeProjectKey(
      body.courseKey ||
      body.courseId ||
      body.courseTitle ||
      body.title ||
      name
    );
    const duplicate = records.find((item) => {
      const itemType = String(item?.data?.entityType || "").toLowerCase();
      if (!/(enrol|enroll|booking)/.test(itemType)) return false;
      const sameUser = String(item?.userId || "") === String(req.compatUserId || "");
      const sameProject = normalizeProjectKey(item?.projectKey) === normalizeProjectKey(req.compatProjectKey);
      const itemCourseKey = normalizeProjectKey(
        item?.data?.courseKey ||
        item?.data?.courseId ||
        item?.data?.courseTitle ||
        item?.name
      );
      return sameUser && sameProject && itemCourseKey === data.courseKey;
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: "You already booked this appointment" });
    }
  }
  const item = {
    id: `pr_${Date.now()}`,
    projectKey: req.compatProjectKey || "",
    userId: req.compatUserId,
    ownerRole: role || "user",
    createdByRole: role || "user",
    updatedByRole: role || "user",
    visibility,
    name: String(name),
    status: String(body.status || body.stage || "active"),
    description: String(body.description || body.notes || body.summary || ""),
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  records.push(item);
  writeCompatStore(records);
  return res.status(201).json({ success: true, project: item });
});

router.put("/:id", (req, res, next) => {
  const authCtx = resolveAuthFromToken(req);
  if (!authCtx?.userId) return next();

  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Record id is required" });
  const body = req.body || {};
  const projectKey = resolveProjectKey(req);
  if (!projectKey) {
    return res.status(400).json({ success: false, message: "Missing project context" });
  }

  const records = readCompatStore();
  const idx = records.findIndex((x) =>
    String(x.id) === id &&
    (!projectKey || normalizeProjectKey(x?.projectKey) === projectKey)
  );
  if (idx < 0) return res.status(404).json({ success: false, message: "Record not found" });

  const current = records[idx];
  const entityType = String(body.entityType || current?.data?.entityType || "record").toLowerCase();
  const normalizedRole = normalizeCompatRole(authCtx.role || "");
  const ownsRecord = String(current?.userId || "") === String(authCtx.userId || "");
  const canCrossRoleEdit =
    normalizedRole === "admin" ||
    (normalizedRole === "doctor" && /(booking|appointment|enrol|enroll|prescription|care_note|lab|report|request)/.test(entityType)) ||
    (normalizedRole === "receptionist" && /(patient|appointment|booking|request)/.test(entityType)) ||
    (normalizedRole === "pharmacist" && /(prescription|medicine|inventory|pharmacy|billing|request|patient)/.test(entityType)) ||
    ((normalizedRole === "lab_technician" || normalizedRole === "lab-technician") && /(lab|report|test|appointment|patient|request)/.test(entityType));
  if (!ownsRecord && !canCrossRoleEdit) {
    return res.status(403).json({ success: false, message: "Permission denied for this update" });
  }
  if (!canWriteEntity(entityType, authCtx.role || "", Boolean(authCtx.hasRole))) {
    return res.status(403).json({ success: false, message: "Only admin can modify this module" });
  }

  const name =
    body.name ||
    body.title ||
    body.workoutType ||
    body.productName ||
    body.patientName ||
    body.studentName ||
    body.leadName ||
    current.name;

  const merged = {
    ...current,
    projectKey: projectKey || current?.projectKey || "",
    name: String(name || current.name || "Record"),
    status: String(body.status || body.stage || current.status || "active"),
    description: String(body.description || body.notes || body.summary || current.description || ""),
    visibility: String(body.visibility || current.visibility || current?.data?.visibility || "private").toLowerCase(),
    data: {
      ...(current.data || {}),
      ...body,
      entityType,
      visibility: String(body.visibility || current?.data?.visibility || current.visibility || "private").toLowerCase(),
      createdByRole: current?.data?.createdByRole || current?.createdByRole || "user",
      updatedByRole: authCtx.role || current?.updatedByRole || "user",
    },
    updatedByRole: authCtx.role || current?.updatedByRole || "user",
    updatedAt: new Date().toISOString(),
  };
  records[idx] = merged;
  writeCompatStore(records);
  return res.json({ success: true, project: merged });
});

router.delete("/:id", (req, res, next) => {
  const authCtx = resolveAuthFromToken(req);
  if (!authCtx?.userId) return next();

  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Record id is required" });
  const projectKey = resolveProjectKey(req);
  if (!projectKey) {
    return res.status(400).json({ success: false, message: "Missing project context" });
  }
  const records = readCompatStore();
  const target = records.find((x) =>
    String(x.id) === id &&
    (!projectKey || normalizeProjectKey(x?.projectKey) === projectKey) &&
    (authCtx.role === "admin" || String(x.userId) === authCtx.userId)
  );
  if (!target) return res.status(404).json({ success: false, message: "Record not found" });
  const entityType = String(target?.data?.entityType || "record").toLowerCase();
  if (!canWriteEntity(entityType, authCtx.role || "", Boolean(authCtx.hasRole))) {
    return res.status(403).json({ success: false, message: "Only admin can delete this module" });
  }
  const nextRows = records.filter((x) =>
    !(
      String(x.id) === id &&
      (!projectKey || normalizeProjectKey(x?.projectKey) === projectKey) &&
      (authCtx.role === "admin" || String(x.userId) === authCtx.userId)
    )
  );
  writeCompatStore(nextRows);
  return res.json({ success: true, message: "Record deleted successfully" });
});

// ---------------------------
// Ensure uploads folder exists
// ---------------------------
const UPLOAD_FOLDER = path.join(__dirname, "../uploads");
if (!fs.existsSync(UPLOAD_FOLDER)) fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// ---------------------------
// Add Project
// ---------------------------
router.post("/add", (req, res) => {
  const { user_id, description, language, ai_result, downloadURL } = req.body;
  if (!user_id || !description || !language) {
    return res.json({ success: false, message: "All fields are required" });
  }

  db.query(
    "INSERT INTO projects (user_id, description, language, ai_result, downloadURL, projectFolder) VALUES (?, ?, ?, ?, ?, ?)",
    [user_id, description, language, ai_result || null, downloadURL || null, req.body.projectFolder || null],
    (err, result) => {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true, message: "Project added successfully!", projectId: result.insertId });
    }
  );
});

// ---------------------------
// Upload Abstract
// ---------------------------
router.post("/upload-abstract", upload.single("file"), (req, res) => {
  if (!req.file) return res.json({ success: false, message: "No file uploaded" });
  const filePath = req.file.path;
  res.json({ success: true, message: "File uploaded successfully", filePath });
});

// ---------------------------
// Get All Projects for a User
// ---------------------------
router.get("/user/:id", (req, res) => {
  const userId = req.params.id;
  db.query("SELECT * FROM projects WHERE user_id = ?", [userId], (err, results) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, projects: results });
  });
});

// ---------------------------
// Get Single Project
// ---------------------------
router.get("/:id", (req, res) => {
  const projectId = req.params.id;
  db.query("SELECT * FROM projects WHERE id = ?", [projectId], (err, results) => {
    if (err) return res.json({ success: false, message: err.message });
    if (results.length === 0) return res.json({ success: false, message: "Project not found" });
    res.json({ success: true, project: results[0] });
  });
});

// ---------------------------
// Delete Project
// ---------------------------
router.delete("/:id", (req, res) => {
  const projectId = req.params.id;
  db.query("DELETE FROM projects WHERE id = ?", [projectId], (err, result) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, message: "Project deleted successfully!" });
  });
});

// ---------------------------
// Start Backend for Preview
// ---------------------------
const { spawn } = require("child_process");
const runningProcesses = {}; // Store running processes by projectId

router.post("/start-preview/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    // Check if already running
    if (runningProcesses[projectId]) {
      return res.json({ success: true, url: `http://localhost:${runningProcesses[projectId].port}` });
    }

    // Get project from DB
    db.query("SELECT * FROM projects WHERE id = ?", [projectId], async (err, results) => {
      if (err || !results.length) return res.status(404).json({ success: false, message: "Project not found" });

      const project = results[0];
      const projectFolder = path.join(__dirname, "../ai_generated/projects", `project_${project.id}`);

      if (!fs.existsSync(projectFolder)) return res.status(404).json({ success: false, message: "Project folder not found" });

      const backendPath = path.join(projectFolder, "backend");
      const languageRaw = String(project.language || "").toLowerCase();
      const isNodeBackend = /(node|javascript|js)/i.test(languageRaw);
      const isPythonBackend = /python/i.test(languageRaw);
      const serverFile = isNodeBackend
        ? path.join(backendPath, "server.js")
        : isPythonBackend
          ? path.join(backendPath, "server.py")
          : null;

      if (!serverFile || !fs.existsSync(serverFile)) {
        // No backend, return frontend only
        return res.json({ success: true, url: null, html: project.ai_result });
      }

      // Find available port
      const port = await findAvailablePort(3001, 4000);

      // Start backend process
      let command, args;
      if (isNodeBackend) {
        command = "node";
        args = [serverFile];
      } else if (isPythonBackend) {
        command = "python";
        args = [serverFile];
      } else {
        return res.status(400).json({ success: false, message: "Unsupported backend language" });
      }

      const child = spawn(command, args, {
        cwd: backendPath,
        stdio: "inherit",
        env: { ...process.env, PORT: String(port) },
      });
      runningProcesses[projectId] = { process: child, port };

      child.on("exit", () => {
        delete runningProcesses[projectId];
      });

      // Wait a bit for server to start
      setTimeout(() => {
        res.json({ success: true, url: `http://localhost:${port}` });
      }, 2000);
    });
  } catch (err) {
    console.error("❌ Start preview error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Helper to find available port
const net = require("net");
const findAvailablePort = (start, end) => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
};

// ---------------------------
// Publish Project locally (from ZIP)
// ---------------------------
const LIVE_APPS_FOLDER = path.join(__dirname, "../preview_projects");
if (!fs.existsSync(LIVE_APPS_FOLDER)) fs.mkdirSync(LIVE_APPS_FOLDER, { recursive: true });

router.post("/publish", async (req, res) => {
  try {
    const { zipName } = req.body;
    if (!zipName) return res.status(400).json({ success: false, message: "ZIP name required" });

    const zipPath = path.join(__dirname, "../generated_projects", zipName);
    if (!fs.existsSync(zipPath)) return res.status(404).json({ success: false, message: "ZIP file not found" });

    const liveFolderName = `app_${Date.now()}`;
    const liveFolderPath = path.join(LIVE_APPS_FOLDER, liveFolderName);
    fs.mkdirSync(liveFolderPath, { recursive: true });

    // Extract ZIP to live folder
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: liveFolderPath })).promise();

    // Detect frontend/public/index.html
    const indexHTMLPath = fs.existsSync(path.join(liveFolderPath, "frontend/public/index.html"))
      ? path.join("frontend/public/index.html")
      : fs.existsSync(path.join(liveFolderPath, "index.html"))
      ? "index.html"
      : null;

    if (!indexHTMLPath) return res.status(500).json({ success: false, message: "index.html not found for preview" });

    const liveURL = `/preview_projects/${liveFolderName}/${indexHTMLPath}?projectKey=${encodeURIComponent(liveFolderName)}`;
    res.json({ success: true, liveURL });
  } catch (err) {
    console.error("❌ Publish error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
