
const express = require("express");
const generatorRouter = require("./generate");

// Backward-compatible AI routes.
// Re-use generator router so both /api/ai/* and /api/generator/* work.

const router = express.Router();

function forwardToGenerator(pathBuilder) {
  return (req, res, next) => {
    const targetPath =
      typeof pathBuilder === "function" ? pathBuilder(req) : pathBuilder;
    req.url = targetPath;
    return generatorRouter(req, res, next);
  };
}

// Legacy aliases used by older frontend builds.
router.post("/generate", forwardToGenerator("/"));
router.post("/refine", forwardToGenerator("/refine"));
router.post(
  "/preview/start/:projectName",
  forwardToGenerator(
    (req) =>
      `/preview/start/${encodeURIComponent(String(req.params.projectName || ""))}`
  )
);
router.get(
  "/preview/status/:projectName",
  forwardToGenerator(
    (req) =>
      `/preview/status/${encodeURIComponent(String(req.params.projectName || ""))}`
  )
);
router.post(
  "/preview/stop/:projectName",
  forwardToGenerator(
    (req) =>
      `/preview/stop/${encodeURIComponent(String(req.params.projectName || ""))}`
  )
);
router.get(
  "/:projectName/blueprint",
  forwardToGenerator(
    (req) =>
      `/${encodeURIComponent(String(req.params.projectName || ""))}/blueprint`
  )
);

// Forward progress endpoints to real generator progress.
router.get(
  "/progress/:requestId",
  forwardToGenerator(
    (req) => `/progress/${encodeURIComponent(String(req.params.requestId || ""))}`
  )
);

router.get(
  "/progress/stream/:requestId",
  forwardToGenerator(
    (req) =>
      `/progress/stream/${encodeURIComponent(String(req.params.requestId || ""))}`
  )
);

router.use("/", generatorRouter);

module.exports = router;
