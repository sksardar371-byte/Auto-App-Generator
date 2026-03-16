const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { readDb, writeDb } = require("../data/store");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: "name, email, password required" });
  }
  const db = readDb();
  if (db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ success: false, message: "Email already exists" });
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = { id: `u_${Date.now()}`, name, email, passwordHash, role: role || "user" };
  db.users.push(user);
  writeDb(db);
  return res.status(201).json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, message: "email and password required" });
  const db = readDb();
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });
  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) return res.status(401).json({ success: false, message: "Invalid credentials" });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET || "dev-secret", { expiresIn: "1d" });
  return res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

module.exports = router;
