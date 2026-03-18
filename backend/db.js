// db.js (dummy, no real database)
module.exports = {
  // Simulate a query function
  query: (sql, params, callback) => {
    console.log("Skipped DB query:", sql, params);
    if (callback) callback(null, []); // return empty results
  },

  // Simulate a connect function
  connect: (cb) => {
    console.log("Skipped DB connection");
    if (cb) cb(null);
  },

  // Simulate event listener
  on: (event, cb) => {
    console.log(`DB event skipped: ${event}`);
  }
};
