let jsonrepairFn = null;
try {
  ({ jsonrepair: jsonrepairFn } = require("jsonrepair"));
} catch (_) {
  // Optional dependency; parser will still work without it.
}

function extractBalancedObject(input) {
  const src = String(input || "");
  const start = src.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return src.slice(start, i + 1);
  }

  return "";
}

function extractBalancedArray(input) {
  const src = String(input || "");
  const start = src.indexOf("[");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "[") depth += 1;
    if (ch === "]") depth -= 1;
    if (depth === 0) return src.slice(start, i + 1);
  }

  return "";
}

function extractCodeFenceJson(input) {
  const src = String(input || "");
  const matches = src.match(/```(?:json)?\s*([\s\S]*?)```/gi);
  if (!matches?.length) return "";
  const last = matches[matches.length - 1];
  return last.replace(/```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}

function extractAllBalancedCandidates(input, openChar, closeChar) {
  const src = String(input || "");
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === closeChar && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        out.push(src.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return out;
}

function normalizeJsonish(input) {
  return String(input || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function stripMarkdownFences(input) {
  return String(input || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseJsonSafe(input) {
  const attempts = [];
  const a = String(input || "").trim();
  const b = normalizeJsonish(a);
  const markdownStripped = stripMarkdownFences(a);
  const markdownNormalized = normalizeJsonish(markdownStripped);
  const fence = extractCodeFenceJson(a);
  const c = normalizeJsonish(fence);
  const d = extractBalancedObject(a);
  const e = normalizeJsonish(d);
  const f = extractBalancedArray(a);
  const g = normalizeJsonish(f);
  attempts.push(a, b, markdownStripped, markdownNormalized, fence, c, d, e, f, g);

  // Some providers prepend reasoning text; parse every balanced JSON candidate.
  const objectCandidates = extractAllBalancedCandidates(a, "{", "}");
  const arrayCandidates = extractAllBalancedCandidates(a, "[", "]");
  const allCandidates = [...objectCandidates, ...arrayCandidates]
    .map((x) => normalizeJsonish(x))
    .filter(Boolean);
  attempts.push(...allCandidates);

  for (const text of attempts.filter(Boolean)) {
    try {
      return JSON.parse(text);
    } catch (_) {
      // try next
    }

    if (jsonrepairFn) {
      try {
        const repaired = jsonrepairFn(text);
        return JSON.parse(repaired);
      } catch (_) {
        // try next
      }
    }
  }
  throw new Error("Invalid JSON output from model");
}

module.exports = {
  parseJsonSafe,
};
