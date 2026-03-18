// db.js (dummy, no MySQL needed)
console.log("⚡ Using dummy DB. All DB calls are skipped.");

const dummyDB = new Proxy(
  {},
  {
    get(target, prop) {
      // Return a function for any db method
      return (...args) => {
        console.log(`Skipped DB call: ${prop.toString()}`, ...args);
        const lastArg = args[args.length - 1];
        if (typeof lastArg === "function") {
          // Callback style: return empty results
          lastArg(null, [], null);
        }
        // For Promise style
        return Promise.resolve([]);
      };
    },
  }
);

module.exports = dummyDB;
