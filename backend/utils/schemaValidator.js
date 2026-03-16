const Ajv = require("ajv");

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: true,      // 🔥 important
  useDefaults: true,
  removeAdditional: false
});

/* ===============================
   PLAN SCHEMA
================================ */

const planSchema = {
  type: "object",
  required: ["projectName"],
  properties: {
    projectName: { type: "string", minLength: 1 },
    stack: { type: "string" },
    features: { type: "array", items: { type: "string" }, default: [] },
    pages: { type: "array", items: { type: "string" }, default: [] },
    routes: { type: "array", items: { type: "string" }, default: [] },
    entities: { type: "array", items: { type: "string" }, default: [] },
    acceptanceCriteria: { type: "array", items: { type: "string" }, default: [] },
  },
  additionalProperties: true,
};

/* ===============================
   FILES SCHEMA
================================ */

const filesSchema = {
  type: "object",
  required: ["projectName", "files"],
  properties: {
    projectName: { type: "string", minLength: 1 },
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string", minLength: 1 },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

const featureFileItemSchema = {
  type: "object",
  required: ["path", "content"],
  properties: {
    path: { type: "string", minLength: 1 },
    content: { type: "string" },
    action: { type: "string", enum: ["replace", "append", "prepend"], default: "replace" },
  },
  additionalProperties: true,
};

const featureSchema = {
  type: "object",
  properties: {
    filesToCreate: {
      type: "array",
      items: featureFileItemSchema,
      default: [],
    },
    filesToUpdate: {
      type: "array",
      items: featureFileItemSchema,
      default: [],
    },
    filesToReplace: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string" },
        },
        additionalProperties: true,
      },
      default: [],
    },
    files: {
      type: "array",
      items: featureFileItemSchema,
      default: [],
    },
  },
  additionalProperties: true,
};

const validatePlan = ajv.compile(planSchema);
const validateFiles = ajv.compile(filesSchema);
const validateFeature = ajv.compile(featureSchema);

/* ===============================
   FORMAT ERRORS
================================ */

function formatErrors(errors = []) {
  return errors.map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message || "is invalid"}`.trim();
  });
}

/* ===============================
   MAIN VALIDATOR
================================ */

function validateAiPayloadShape(payload, schemaType) {
  if (!schemaType) return { ok: true, issues: [] };

  try {
    if (schemaType === "plan") {
      const ok = validatePlan(payload);
      return { ok, issues: ok ? [] : formatErrors(validatePlan.errors) };
    }

    if (schemaType === "files") {
      const ok = validateFiles(payload);
      return { ok, issues: ok ? [] : formatErrors(validateFiles.errors) };
    }

    if (schemaType === "feature") {
      const ok = validateFeature(payload);
      return { ok, issues: ok ? [] : formatErrors(validateFeature.errors) };
    }

    return { ok: true, issues: [] };
  } catch (err) {
    return {
      ok: false,
      issues: ["Schema validation crashed: " + err.message],
    };
  }
}

module.exports = {
  validateAiPayloadShape,
};
