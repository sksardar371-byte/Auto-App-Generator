const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { readDb, writeDb } = require("../data/store");

const router = express.Router();

function getDb() {
  const db = readDb();
  db.workouts = Array.isArray(db.workouts) ? db.workouts : [];
  return db;
}

router.get("/", requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.workouts.filter((x) => x.userId === req.user.sub);
  res.json({ success: true, workouts: rows });
});

router.post("/", requireAuth, (req, res) => {
  const { date, exerciseName, sets, reps, weight, notes } = req.body || {};
  if (!date || !exerciseName || !sets || !reps) {
    return res.status(400).json({ success: false, message: "date, exerciseName, sets, reps are required" });
  }
  const db = getDb();
  const item = {
    id: `wo_${Date.now()}`,
    userId: req.user.sub,
    date: String(date),
    exerciseName: String(exerciseName),
    sets: Number(sets),
    reps: Number(reps),
    weight: Number(weight || 0),
    notes: String(notes || ""),
    createdAt: new Date().toISOString(),
  };
  db.workouts.push(item);
  writeDb(db);
  res.status(201).json({ success: true, workout: item });
});

module.exports = router;

