const jwt = require("jsonwebtoken");
const SECRET = "your_jwt_secret";

module.exports = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ msg: "Invalid token" });
    req.user = { id: decoded.id };
    next();
  });
};
