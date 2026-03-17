// db.js
const mysql = require("mysql2");
require("dotenv").config();

let dbConfig;

// If MYSQL_PUBLIC_URL exists, parse it
if (process.env.MYSQL_PUBLIC_URL) {
  // Example: mysql://root:password@trolley.proxy.rlwy.net:55133/railway
  const url = new URL(process.env.MYSQL_PUBLIC_URL);
  dbConfig = {
    host: url.hostname,
    port: Number(url.port),
    user: url.username,
    password: url.password,
    database: url.pathname.replace("/", ""), // remove leading slash
    connectTimeout: 10000,
  };
} else {
  // Local development
  dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "railway",
    connectTimeout: 10000,
  };
}

const db = mysql.createConnection(dbConfig);

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Connected to MySQL database.");
  }
});

db.on("error", (err) => {
  console.error("Database runtime error:", err?.code || err?.message || err);
});

module.exports = db;
