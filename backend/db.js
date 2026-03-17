// db.js
const mysql = require("mysql2");

// ✅ Ensure environment variables exist
["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"].forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Environment variable ${key} is missing!`);
    process.exit(1);
  }
});

// ✅ Create MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,                 // e.g., mysql-qjb2.railway.internal
  port: Number(process.env.DB_PORT),         // e.g., 3306
  user: process.env.DB_USER,                 // e.g., root
  password: process.env.DB_PASSWORD,         // e.g., Railway password
  database: process.env.DB_NAME,             // e.g., railway
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// ✅ Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Connected to MySQL database.");
  }
});

// ✅ Handle runtime errors
db.on("error", (err) => {
  console.error("Database runtime error:", err?.code || err?.message || err);
});

module.exports = db;
