const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const router = express.Router();

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

function resolveUserFromToken(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    return String(decoded?.sub || decoded?.id || decoded?.email || "");
  } catch (_err) {
    return null;
  }
}

function requireCompatAuth(req, res, next) {
  const userId = resolveUserFromToken(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Missing or invalid token" });
  }
  req.compatUserId = userId;
  next();
}

function scopedRows(userId) {
  const all = readCompatStore();
  return all.filter((row) => row && String(row.userId || "") === String(userId || ""));
}

router.get("/summary", requireCompatAuth, (req, res) => {
  const rows = scopedRows(req.compatUserId);
  const totalRecords = rows.length;
  const activeRecords = rows.filter((r) => String(r.status || "").toLowerCase() === "active").length;
  const completedRecords = rows.filter((r) => String(r.status || "").toLowerCase() === "completed").length;
  const pendingRecords = rows.filter((r) => String(r.status || "").toLowerCase() === "pending").length;

  const top = rows.reduce((acc, row) => {
    const key = String(row?.data?.entityType || "record").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topEntities = Object.entries(top)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([entity, count]) => ({ entity, count }));

  return res.json({
    success: true,
    summary: {
      totalRecords,
      activeRecords,
      completedRecords,
      pendingRecords,
      topEntities,
      updatedAt: new Date().toISOString(),
    },
  });
});

router.get("/activity", requireCompatAuth, (req, res) => {
  const rows = scopedRows(req.compatUserId)
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      entityType: row?.data?.entityType || "record",
      at: row.updatedAt || row.createdAt || null,
    }));
  return res.json({ success: true, activity: rows });
});

router.get("/stats", requireCompatAuth, (req, res) => {
  const rows = scopedRows(req.compatUserId);
  const now = new Date();
  const labels = [];
  const counts = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key);
    counts.push(rows.filter((r) => String(r.createdAt || "").slice(0, 10) === key).length);
  }

  const statusBreakdown = rows.reduce((acc, row) => {
    const key = String(row.status || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return res.json({
    success: true,
    stats: {
      labels,
      counts,
      statusBreakdown,
      activeUsersNow: Math.max(1, Math.min(25, rows.length)),
      serverOnline: true,
      updatedAt: new Date().toISOString(),
    },
  });
});

module.exports = router;

