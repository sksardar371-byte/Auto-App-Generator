const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { readDb } = require("../data/store");

const router = express.Router();

function getScopedRows(user) {
  const db = readDb();
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin") return db.projects;
  return db.projects.filter((row) => String(row?.userId || "") === String(user?.sub || ""));
}

function toLower(value) {
  return String(value || "").toLowerCase();
}

router.get("/summary", requireAuth, (req, res) => {
  const rows = getScopedRows(req.user);
  const total = rows.length;
  const active = rows.filter((r) => toLower(r.status) === "active").length;
  const completed = rows.filter((r) => toLower(r.status) === "completed").length;
  const pending = rows.filter((r) => toLower(r.status) === "pending").length;

  const byEntity = rows.reduce((acc, row) => {
    const entity = toLower(row?.data?.entityType || "record");
    acc[entity] = (acc[entity] || 0) + 1;
    return acc;
  }, {});

  const topEntities = Object.entries(byEntity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([entity, count]) => ({ entity, count }));

  res.json({
    success: true,
    summary: {
      totalRecords: total,
      activeRecords: active,
      completedRecords: completed,
      pendingRecords: pending,
      topEntities,
      updatedAt: new Date().toISOString(),
    },
  });
});

router.get("/activity", requireAuth, (req, res) => {
  const rows = getScopedRows(req.user)
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

  res.json({ success: true, activity: rows });
});

router.get("/stats", requireAuth, (req, res) => {
  const rows = getScopedRows(req.user);
  const now = new Date();
  const labels = [];
  const counts = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key);
    counts.push(
      rows.filter((row) => String(row.createdAt || "").slice(0, 10) === key).length
    );
  }

  const statusBreakdown = rows.reduce((acc, row) => {
    const key = toLower(row.status || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  res.json({
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
