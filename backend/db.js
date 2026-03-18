// db.js (dummy, no DB connection)
module.exports = {
  query: (sql, params, callback) => {
    console.log("Skipped DB query:", sql, params);
    if (callback) callback(null, []);
  },
  connect: (cb) => {
    console.log("Skipped DB connection");
    if (cb) cb(null);
  },
  on: (event, cb) => {},
};
