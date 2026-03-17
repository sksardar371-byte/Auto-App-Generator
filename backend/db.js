const mysql = require('mysql2');

// Check env vars
['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME'].forEach(key => {
  if (!process.env[key]) {
    console.error(`❌ Environment variable ${key} is missing!`);
    process.exit(1); // Stop app if any env is missing
  }
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,const mysql = require('mysql2');

// Validate env vars
['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME'].forEach(key => {
  if (!process.env[key]) {
    console.error(`❌ Environment variable ${key} is missing!`);
    process.exit(1);
  }
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,           // mysql-qjb2.railway.internal
  port: Number(process.env.DB_PORT),   // 3306
  user: process.env.DB_USER,           // root
  password: process.env.DB_PASSWORD,   // Railway password
  database: process.env.DB_NAME,       // railway
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

db.connect(err => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Connected to MySQL database.');
  }
});

db.on('error', err => {
  console.error('Database runtime error:', err?.code || err?.message || err);
});

module.exports = db;
  database: process.env.DB_NAME,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

db.connect(err => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Connected to MySQL database.');
  }
});

db.on('error', err => {
  console.error('Database runtime error:', err?.code || err?.message || err);
});

module.exports = db;
