module.exports = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 27017),
  dbName: process.env.DB_NAME || "app_db"
};
