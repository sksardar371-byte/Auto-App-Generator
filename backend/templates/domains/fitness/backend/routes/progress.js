const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { readDb, writeDb } = require("../data/store");

const router = express.Router();

function getDb() {
  const db = readDb();
  db.progress = Array.isArray(db.progress) ? db.progress : [];
  return db;
}

router.get("/", requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.progress.filter((x) => x.userId === req.user.sub);
  res.json({ success: true, progress: rows });
});

router.post("/", requireAuth, (req, res) => {
  const { date, weight, bodyFat } = req.body || {};
  if (!date || !weight) {
    return res.status(400).json({ success: false, message: "date and weight are required" });
  }
  const db = getDb();
  const item = {
    id: `pr_${Date.now()}`,
    userId: req.user.sub,
    date: String(date),
    weight: Number(weight),
    bodyFat: bodyFat === undefined || bodyFat === "" ? null : Number(bodyFat),
    createdAt: new Date().toISOString(),
  };
  db.progress.push(item);
  writeDb(db);
  res.status(201).json({ success: true, progress: item });
});

module.exports = router;

