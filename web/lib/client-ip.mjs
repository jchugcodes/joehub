export function clientIp(request, env = {}, peer = "direct") {
  // The Next.js route Request has no TCP peer. Callers pass "direct" unless
  // a future proxy adapter has already checked the socket against
  // JOEHUB_TRUSTED_PROXIES. A client-supplied X-Forwarded-For is ignored.
  const trusted = String((env && env.JOEHUB_TRUSTED_PROXIES) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (trusted.includes(peer)) {
    const forwarded = request.headers.get("x-forwarded-for") || "";
    const hop = forwarded.split(",")[0].trim().slice(0, 64);
    if (hop) return hop;
  }
  return peer || "direct";
}
