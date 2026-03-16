const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { readDb, writeDb } = require("../data/store");

const router = express.Router();

function readItems() {
  const db = readDb();
  db.exercises = Array.isArray(db.exercises) ? db.exercises : [];
  return db;
}

router.get("/", requireAuth, (req, res) => {
  const db = readItems();
  const rows = db.exercises.filter((x) => x.userId === req.user.sub);
  res.json({ success: true, exercises: rows });
});

router.post("/", requireAuth, (req, res) => {
  const { name, muscleGroup, description, difficulty } = req.body || {};
  if (!name || !muscleGroup || !difficulty) {
    return res.status(400).json({ success: false, message: "name, muscleGroup, difficulty are required" });
  }
  const db = readItems();
  const item = {
    id: `ex_${Date.now()}`,
    userId: req.user.sub,
    name: String(name),
    muscleGroup: String(muscleGroup),
    description: String(description || ""),
    difficulty: String(difficulty),
    createdAt: new Date().toISOString(),
  };
  db.exercises.push(item);
  writeDb(db);
  res.status(201).json({ success: true, exercise: item });
});

module.exports = router;

