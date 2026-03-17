const mysql = require('mysql2');
require('dotenv').config(); // Load env variables

if (!process.env.MYSQL_PUBLIC_URL) {
  console.error("❌ MYSQL_PUBLIC_URL is missing in environment variables!");
  process.exit(1); // stop server if no DB
}

const url = new URL(process.env.MYSQL_PUBLIC_URL);

const db = mysql.createConnection({
  host: url.hostname,
  port: url.port,
  user: url.username,
  password: url.password,
  database: url.pathname.replace("/", ""),
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

db.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to MySQL database.');
  }
});

db.on('error', (err) => {
  console.error('⚠️ Database runtime error:', err?.code || err?.message || err);
});

module.exports = db;
