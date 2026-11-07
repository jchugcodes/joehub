export function createLimiter(limit, windowMs = 60000) {
  const hits = new Map();
  return {
    allow(key, now) {
      const bucket = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
      if (bucket.length >= limit) {
        hits.set(key, bucket);
        return false;
      }
      bucket.push(now);
      hits.set(key, bucket);
      return true;
    },
  };
}
