const Project = require("../models/Project");

exports.createProject = (req, res) => {
  const { desc, lang } = req.body;
  const userId = req.user.id; // from auth middleware
  Project.create(userId, desc, lang, (err, results) => {
    if (err) return res.status(500).json({ msg: "DB error" });
    res.json({ msg: "Project created", projectId: results.insertId });
  });
};

exports.getProjects = (req, res) => {
  const userId = req.user.id;
  Project.getByUser(userId, (err, results) => {
    if (err) return res.status(500).json({ msg: "DB error" });
    res.json(results);
  });
};

exports.clearProjects = (req, res) => {
  const userId = req.user.id;
  Project.deleteAllByUser(userId, (err, results) => {
    if (err) return res.status(500).json({ msg: "DB error" });
    res.json({ msg: "All projects deleted" });
  });
};
