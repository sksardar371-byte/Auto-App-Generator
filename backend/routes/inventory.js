const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../data");
const DB_FILE = path.join(DATA_DIR, "inventory.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ records: [] }, null, 2), "utf8");

function readDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (_err) {
    return [];
  }
}

function writeDb(records) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ records: records || [] }, null, 2), "utf8");
}

function resolveAuth(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    const userId = String(decoded?.sub || decoded?.id || decoded?.email || "");
    if (!userId) return null;
    return { userId, role: String(decoded?.role || "").toLowerCase(), hasRole: Boolean(decoded?.role) };
  } catch (_err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const auth = resolveAuth(req);
  if (!auth) return res.status(401).json({ success: false, message: "Missing or invalid token" });
  req.auth = auth;
  next();
}

function requireAdminWhenRoleExists(req, res, next) {
  // Backward compatible: only enforce if role claim exists in token.
  if (req.auth.hasRole && req.auth.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin role required" });
  }
  next();
}

router.get("/", requireAuth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase().trim();
  const rows = readDb()
    .filter((x) => String(x.userId) === req.auth.userId)
    .filter((x) => (q ? JSON.stringify(x).toLowerCase().includes(q) : true))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  res.json({ success: true, inventory: rows, total: rows.length });
});

router.post("/", requireAuth, requireAdminWhenRoleExists, (req, res) => {
  const body = req.body || {};
  const name = body.productName || body.name || "Inventory Item";
  const record = {
    id: `inv_${Date.now()}`,
    userId: req.auth.userId,
    name: String(name),
    status: String(body.status || "active"),
    data: body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const rows = readDb();
  rows.push(record);
  writeDb(rows);
  res.status(201).json({ success: true, item: record });
});

router.put("/:id", requireAuth, requireAdminWhenRoleExists, (req, res) => {
  const id = String(req.params.id || "");
  const rows = readDb();
  const idx = rows.findIndex((x) => String(x.id) === id && String(x.userId) === req.auth.userId);
  if (idx < 0) return res.status(404).json({ success: false, message: "Inventory item not found" });
  rows[idx] = {
    ...rows[idx],
    status: String(req.body?.status || rows[idx].status || "active"),
    data: { ...(rows[idx].data || {}), ...(req.body || {}) },
    updatedAt: new Date().toISOString(),
  };
  writeDb(rows);
  res.json({ success: true, item: rows[idx] });
});

router.delete("/:id", requireAuth, requireAdminWhenRoleExists, (req, res) => {
  const id = String(req.params.id || "");
  const rows = readDb();
  const next = rows.filter((x) => !(String(x.id) === id && String(x.userId) === req.auth.userId));
  if (next.length === rows.length) return res.status(404).json({ success: false, message: "Inventory item not found" });
  writeDb(next);
  res.json({ success: true, message: "Inventory item deleted" });
});

module.exports = router;
