const NodeCache = require("node-cache");

// Cache items for 24 hours (86400 seconds) with a maximum of 5000 items in memory
const subCache = new NodeCache({
  stdTTL: 86400,
  checkperiod: 3600,
  maxKeys: 5000,
  useClones: false
});

module.exports = {
  get: (key) => subCache.get(key),
  set: (key, val) => subCache.set(key, val)
};

