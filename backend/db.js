// db.js (dummy)
module.exports = new Proxy({}, {
  get(target, prop) {
    return (...args) => {
      console.log(`Skipped DB call: ${prop.toString()}`, ...args);
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb(null, []); // return empty array for query callbacks
    };
  }
});
