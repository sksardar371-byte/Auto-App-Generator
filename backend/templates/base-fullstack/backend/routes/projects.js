const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { readDb, writeDb } = require("../data/store");

const router = express.Router();

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== "") {
      out[key] = obj[key];
    }
  }
  return out;
}

function normalizeEntityType(value) {
  return String(value || "").toLowerCase().trim();
}

function isEnrollmentEntity(value) {
  const entity = normalizeEntityType(value);
  return ["enrollment", "enrollments", "enrolment", "enrolments", "registration", "registrations"].includes(entity);
}

function isStudentWritableEntity(value) {
  const entity = normalizeEntityType(value);
  return (
    isEnrollmentEntity(entity) ||
    ["discussion_post", "discussion", "comment", "comments", "certificate_request", "certificate_requests"].includes(entity)
  );
}

function canWriteEntity(req, entityType) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role === "admin") return true;
  return isStudentWritableEntity(entityType);
}

function scopedRowsForRead(req, rows) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role === "admin") return rows;
  return rows.filter((row) => {
    const ownedByCurrentUser = String(row?.userId || "") === String(req.user?.sub || "");
    const isShared =
      String(row?.visibility || "").toLowerCase() === "public" ||
      String(row?.data?.visibility || "").toLowerCase() === "public";
    const createdByAdmin =
      String(row?.createdByRole || "").toLowerCase() === "admin" ||
      String(row?.ownerRole || "").toLowerCase() === "admin" ||
      String(row?.data?.createdByRole || "").toLowerCase() === "admin";
    return ownedByCurrentUser || isShared || createdByAdmin;
  });
}

router.get("/", requireAuth, (req, res) => {
  const db = readDb();
  const scoped = scopedRowsForRead(req, db.projects);

  const entityType = String(req.query.entityType || "").trim().toLowerCase();
  const query = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim().toLowerCase();
  let rows = [...scoped];

  if (entityType) {
    rows = rows.filter((row) => String(row?.data?.entityType || "").toLowerCase() === entityType);
  }
  if (status) {
    rows = rows.filter((row) => {
      const rowStatus = String(row.status || row?.data?.status || row?.data?.stage || "").toLowerCase();
      return rowStatus === status;
    });
  }
  if (query) {
    rows = rows.filter((row) => {
      const haystack = [
        row.name,
        row.status,
        row.description,
        JSON.stringify(row.data || {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  res.json({ success: true, projects: rows });
});

router.post("/", requireAuth, (req, res) => {
  const body = req.body || {};
  const role = String(req.user?.role || "").toLowerCase();
  const entityType = body.entityType || body.type || "record";
  if (!canWriteEntity(req, entityType)) {
    return res.status(403).json({
      success: false,
      message: "Only admins can create this record type. Non-admin users can create enrollment records only.",
    });
  }
  const nameCandidate =
    body.name ||
    body.title ||
    body.workoutType ||
    body.productName ||
    body.patientName ||
    body.studentName ||
    body.leadName;
  if (!nameCandidate) {
    return res.status(400).json({ success: false, message: "A primary name field is required" });
  }

  const statusCandidate = body.status || body.stage || "active";
  const descriptionCandidate =
    body.description || body.notes || body.summary || body.diagnosis || "";

  const data = pick(body, Object.keys(body));
  const visibility = String(data.visibility || body.visibility || (role === "admin" ? "public" : "private")).toLowerCase();
  data.visibility = visibility;
  data.createdByRole = role;
  if (isEnrollmentEntity(entityType)) {
    data.courseKey = normalizeEntityType(
      body.courseKey ||
      body.courseId ||
      body.courseTitle ||
      body.title ||
      nameCandidate
    );
  }
  const db = readDb();
  if (isEnrollmentEntity(entityType)) {
    const duplicate = db.projects.find((row) => {
      const rowType = normalizeEntityType(row?.data?.entityType);
      if (!isEnrollmentEntity(rowType)) return false;
      const sameUser = String(row?.userId || "") === String(req.user?.sub || "");
      const rowCourseKey = normalizeEntityType(
        row?.data?.courseKey ||
        row?.data?.courseId ||
        row?.data?.courseTitle ||
        row?.name
      );
      return sameUser && rowCourseKey && rowCourseKey === data.courseKey;
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: "You are already enrolled in this course" });
    }
  }
  const item = {
    id: `p_${Date.now()}`,
    userId: req.user.sub,
    ownerRole: role,
    createdByRole: role,
    visibility,
    name: String(nameCandidate),
    status: String(statusCandidate),
    description: String(descriptionCandidate),
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.projects.push(item);
  writeDb(db);
  res.status(201).json({ success: true, project: item });
});

router.put("/:id", requireAuth, (req, res) => {
  const role = String(req.user?.role || "").toLowerCase();
  const db = readDb();
  const idx = db.projects.findIndex((p) => p.id === req.params.id && (role === "admin" || String(p?.userId || "") === String(req.user?.sub || "")));
  if (idx < 0) {
    return res.status(404).json({ success: false, message: "Record not found" });
  }
  const current = db.projects[idx];
  const body = req.body || {};
  const entityType = normalizeEntityType(body.entityType || current?.data?.entityType || "record");
  if (!canWriteEntity(req, entityType)) {
    return res.status(403).json({ success: false, message: "Only admins can update this record type. Non-admin users can update enrollment records only." });
  }
  const data = pick(body, Object.keys(body));
  const nameCandidate =
    body.name ||
    body.title ||
    body.workoutType ||
    body.productName ||
    body.patientName ||
    body.studentName ||
    body.leadName ||
    current.name;
  const statusCandidate = body.status || body.stage || current.status || "active";
  const descriptionCandidate =
    body.description || body.notes || body.summary || body.diagnosis || current.description || "";

  db.projects[idx] = {
    ...current,
    name: String(nameCandidate),
    status: String(statusCandidate),
    description: String(descriptionCandidate),
    visibility: String(data.visibility || current.visibility || current?.data?.visibility || "private").toLowerCase(),
    data: {
      ...(current.data || {}),
      ...data,
      entityType,
      createdByRole: current?.data?.createdByRole || current?.createdByRole || "user",
      updatedByRole: role || current?.data?.updatedByRole || "user",
      visibility: String(data.visibility || current?.data?.visibility || current.visibility || "private").toLowerCase(),
    },
    updatedByRole: role || current?.updatedByRole || "user",
    updatedAt: new Date().toISOString(),
  };
  writeDb(db);
  res.json({ success: true, project: db.projects[idx] });
});

router.delete("/:id", requireAuth, (req, res) => {
  if (String(req.user?.role || "").toLowerCase() !== "admin") {
    return res.status(403).json({ success: false, message: "Only admin can delete records" });
  }
  const db = readDb();
  const idx = db.projects.findIndex((p) => p.id === req.params.id);
  if (idx < 0) {
    return res.status(404).json({ success: false, message: "Record not found" });
  }
  const removed = db.projects.splice(idx, 1)[0];
  writeDb(db);
  res.json({ success: true, deletedId: removed.id });
});

module.exports = router;
