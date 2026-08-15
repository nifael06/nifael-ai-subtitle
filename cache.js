const NodeCache = require("node-cache");

// Cache items for 24 hours (86400 seconds) with a maximum of 5,000 items in memory
const subCache = new NodeCache({
  stdTTL: 86400,
  checkperiod: 1800,
  maxKeys: 5000,
  useClones: false
});

module.exports = {
  get: (key) => {
    if (!key) return null;
    try {
      return subCache.get(key);
    } catch {
      return null;
    }
  },
  set: (key, val, ttl = 86400) => {
    if (!key || !val) return false;
    try {
      return subCache.set(key, val, ttl);
    } catch {
      return false;
    }
  },
  del: (key) => {
    if (!key) return false;
    try {
      return subCache.del(key);
    } catch {
      return false;
    }
  },
  flush: () => {
    try {
      subCache.flushAll();
    } catch {}
  },
  stats: () => {
    try {
      return subCache.getStats();
    } catch {
      return { keys: 0, hits: 0, misses: 0 };
    }
  }
};
