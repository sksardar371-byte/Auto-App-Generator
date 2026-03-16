const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const projectsRoutes = require("./routes/projects");
const dashboardRoutes = require("./routes/dashboard");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/api/health", (_req, res) => {
  res.json({ success: true, service: "base-fullstack", status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, message: "API route not found" });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.listen(PORT, () => {
  console.log(`Base template server running on http://localhost:${PORT}`);
});
