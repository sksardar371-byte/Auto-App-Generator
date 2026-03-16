const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return res.status(401).json({ success: false, message: "Missing token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    req.user = payload;
    next();
  } catch (_err) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function requireRole(roles = []) {
  const allow = new Set((Array.isArray(roles) ? roles : [roles]).map((r) => String(r || "").toLowerCase()));
  return (req, res, next) => {
    const role = String(req.user?.role || "").toLowerCase();
    if (!allow.size || allow.has(role)) return next();
    return res.status(403).json({ success: false, message: "Forbidden: insufficient role" });
  };
}

module.exports = { requireAuth, requireRole };
