const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname);
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ users: [], projects: [] }, null, 2),
      "utf8"
    );
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    };
  } catch {
    return { users: [], projects: [] };
  }
}

function writeDb(data) {
  ensureDb();
  const next = {
    users: Array.isArray(data?.users) ? data.users : [],
    projects: Array.isArray(data?.projects) ? data.projects : [],
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(next, null, 2), "utf8");
}

module.exports = {
  readDb,
  writeDb,
};
