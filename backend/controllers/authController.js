const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const SECRET = "your_jwt_secret";

exports.signup = (req, res) => {
  const { username, email, password } = req.body;
  User.findByEmail(email, (err, results) => {
    if (err) return res.status(500).json({ msg: "DB error" });
    if (results.length > 0) return res.status(400).json({ msg: "Email already exists" });

    const hashedPassword = bcrypt.hashSync(password, 8);
    User.create(username, email, hashedPassword, (err, results) => {
      if (err) return res.status(500).json({ msg: "DB error" });

      const token = jwt.sign({ id: results.insertId }, SECRET, { expiresIn: "1h" });
      res.json({ token, user: { id: results.insertId, username } });
    });
  });
};

exports.signin = (req, res) => {
  const { email, password } = req.body;
  User.findByEmail(email, (err, results) => {
    if (err) return res.status(500).json({ msg: "DB error" });
    if (results.length === 0) return res.status(400).json({ msg: "User not found" });

    const user = results[0];
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.status(400).json({ msg: "Invalid password" });

    const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "1h" });
    res.json({ token, user: { id: user.id, username: user.username } });
  });
};
