const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();

function normalizeRole(input) {
  const role = String(input || "user")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
  const aliases = {
    owner: "restaurant_owner",
    restaurantowner: "restaurant_owner",
    vendor: "restaurant_owner",
    delivery: "delivery_partner",
    deliveryagent: "delivery_partner",
    delivery_agent: "delivery_partner",
    deliverypartner: "delivery_partner",
    rider: "delivery_partner",
  };
  const normalized = aliases[role] || role;
  const allowed = new Set([
    "admin",
    "user",
    "student",
    "instructor",
    "customer",
    "restaurant_owner",
    "delivery_partner",
    "delivery",
    "delivery_agent",
    "doctor",
    "receptionist",
    "patient",
    "pharmacist",
    "lab_technician",
  ]);
  return allowed.has(normalized) ? normalized : "user";
}

function isDbUnavailableError(err) {
  const code = String(err?.code || "");
  return [
    "ETIMEDOUT",
    "ECONNREFUSED",
    "PROTOCOL_CONNECTION_LOST",
    "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  ].includes(code);
}

function ensureUsersRoleColumn() {
    db.query("SHOW COLUMNS FROM users LIKE 'role'", (checkErr, rows) => {
    if (checkErr) {
      console.warn("users.role check failed:", checkErr.message);
      return;
    }
    if (Array.isArray(rows) && rows.length > 0) return;
    db.query(
      "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user'",
      (alterErr) => {
        if (alterErr) {
          console.warn("users.role add failed:", alterErr.message);
        }
      }
    );
  });
}

ensureUsersRoleColumn();

function signAuthToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || "your_jwt_secret", { expiresIn: "2h" });
}

async function handleSignup(req, res) {
  const username = String(req.body?.username || req.body?.name || req.body?.fullName || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const role = normalizeRole(req.body?.role);

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query(
      "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
      [username, email, hashedPassword, role],
      (err, result) => {
        if (err) {
          if (isDbUnavailableError(err)) {
            return res.status(503).json({ success: false, message: "Database unavailable. Please try again." });
          }
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ success: false, message: "Email already exists" });
          }

          // Backward compatibility if users.role column is still missing.
          if (err.code === "ER_BAD_FIELD_ERROR" || err.code === "ER_NO_SUCH_FIELD") {
            return db.query(
              "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
              [username, email, hashedPassword],
              (legacyErr, legacyResult) => {
                if (legacyErr) {
                  if (isDbUnavailableError(legacyErr)) {
                    return res.status(503).json({ success: false, message: "Database unavailable. Please try again." });
                  }
                  if (legacyErr.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({ success: false, message: "Email already exists" });
                  }
                  return res.status(500).json({ success: false, message: legacyErr.message });
                }
                const token = signAuthToken({
                  id: legacyResult.insertId,
                  sub: legacyResult.insertId,
                  email,
                  username,
                  role: "user",
                });
                return res.status(201).json({
                  success: true,
                  message: "User created successfully",
                  userId: legacyResult.insertId,
                  username,
                  role: "user",
                  token,
                  user: { id: legacyResult.insertId, username, email, role: "user" },
                });
              }
            );
          }

          return res.status(500).json({ success: false, message: err.message });
        }

        const token = signAuthToken({
          id: result.insertId,
          sub: result.insertId,
          email,
          username,
          role,
        });

        return res.status(201).json({
          success: true,
          message: "User created successfully",
          userId: result.insertId,
          username,
          role,
          token,
          user: { id: result.insertId, username, email, role },
        });
      }
    );
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

function handleSignin(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err) {
      if (isDbUnavailableError(err)) {
        return res.status(503).json({ success: false, message: "Database unavailable. Please try again." });
      }
      return res.status(500).json({ success: false, message: err.message });
    }
    if (results.length === 0) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const role = normalizeRole(user.role);
    const token = signAuthToken({
      id: user.id,
      sub: user.id,
      email: user.email,
      username: user.username,
      role,
    });

    return res.json({
      success: true,
      message: "Login successful",
      userId: user.id,
      role,
      token,
      user: { id: user.id, username: user.username, email: user.email, role },
    });
  });
}

router.post("/signup", handleSignup);
router.post("/register", handleSignup);
router.post("/signin", handleSignin);
router.post("/login", handleSignin);

module.exports = router;
