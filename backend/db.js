// db.js
const mysql = require("mysql2");

// Use PUBLIC URL for external connections
const db = mysql.createConnection(process.env.MYSQL_PUBLIC_URL);

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Connected to MySQL database via PUBLIC URL.");
  }
});

db.on("error", (err) => {
  console.error("Database runtime error:", err?.code || err?.message || err);
});

module.exports = db;
