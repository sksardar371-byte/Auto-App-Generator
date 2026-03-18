const path = require("path");
const express = require("express");
const cors = require("cors");
const fs = require("fs");

// ---------------------------
// ✅ Express app
// ---------------------------
const app = express();

// ---------------------------
// ✅ CORS
// ---------------------------
app.use(cors());

// ---------------------------
// ✅ Body Parser
// ---------------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------------------------
// ✅ Ensure folders exist
// ---------------------------
const GENERATED_FOLDER = path.resolve(
  String(process.env.GENERATED_PROJECTS_DIR || path.join(__dirname, "generated_projects"))
);
const UPLOAD_FOLDER = path.resolve(
  String(process.env.UPLOADS_DIR || path.join(__dirname, "uploads"))
);
const PREVIEW_FOLDER = path.resolve(
  String(process.env.PREVIEW_PROJECTS_DIR || path.join(__dirname, "preview_projects"))
);

[GENERATED_FOLDER, UPLOAD_FOLDER, PREVIEW_FOLDER].forEach((folder) => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
});

// ---------------------------
// ✅ Routes
// ---------------------------
const authRoutes = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const ordersRoutes = require("./routes/orders");
const inventoryRoutes = require("./routes/inventory");
const dashboardRoutes = require("./routes/dashboard");
const aiRoutes = require("./routes/ai");
const generatorRoutes = require("./routes/generate");

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ai", aiRoutes);

// Generator routes
app.post("/api/generate", (req, res, next) => {
  req.url = "/";
  return generatorRoutes(req, res, next);
});
app.post("/api/generator/generate", (req, res, next) => {
  req.url = "/";
  return generatorRoutes(req, res, next);
});
app.use("/api/generator", generatorRoutes);

// ---------------------------
// ✅ Static Files
// ---------------------------
app.use("/generated_projects", express.static(GENERATED_FOLDER));
app.use("/preview_projects", express.static(PREVIEW_FOLDER));
app.use("/uploads", express.static(UPLOAD_FOLDER));
app.use("/ai_generated", express.static(path.join(__dirname, "ai_generated")));

// ---------------------------
// ✅ Health API
// ---------------------------
app.get("/api/health", (_req, res) => {
  res.json({ success: true, service: "auto-app-generator-backend" });
});

// ---------------------------
// ✅ Root API
// ---------------------------
app.get("/", (_req, res) => {
  res.send("🚀 Auto App Generator Backend is running...");
});

// ---------------------------
// ❌ 404 Handler
// ---------------------------
app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, message: "API route not found" });
});

// ---------------------------
// ✅ Start Server
// ---------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
