const buckets = new Map();

function pruneExpiredEntries(now) {
  for (const [key, entry] of buckets.entries()) {
    if (entry.expiresAt <= now) {
      buckets.delete(key);
    }
  }
}

export function createRateLimiter({ max, message, windowMs, prefix }) {
  return function rateLimit(req, res, next) {
    if (process.env.NODE_ENV === "test") {
      return next();
    }

    const now = Date.now();
    pruneExpiredEntries(now);

    const identity = req.userId || req.ip || "anonymous";
    const key = `${prefix}:${identity}`;
    const current = buckets.get(key);

    if (!current || current.expiresAt <= now) {
      buckets.set(key, {
        count: 1,
        expiresAt: now + windowMs
      });
      return next();
    }

    if (current.count >= max) {
      return res.status(429).json({ message });
    }

    current.count += 1;
    return next();
  };
}
