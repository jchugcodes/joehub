function header(request, name) {
  const value = request.headers.get(name) || "";
  return value.split(",")[0].trim().slice(0, 64);
}

export function clientIp(request, env = {}, peer = "direct") {
  // On Vercel, x-forwarded-for is overwritten to stop spoofing, and a proxy
  // in front of Vercel can overwrite it again. x-vercel-forwarded-for is the
  // platform copy. Off Vercel those headers are client input and are ignored.
  // https://vercel.com/docs/headers/request-headers
  if (env.VERCEL === "1") {
    const vercelIp = header(request, "x-vercel-forwarded-for");
    return vercelIp || "unverified";
  }
  const trusted = String((env && env.JOEHUB_TRUSTED_PROXIES) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (trusted.includes(peer)) {
    const hop = header(request, "x-forwarded-for");
    if (hop) return hop;
  }
  return peer || "direct";
}

function previewUsesProduction(env, origin) {
  if (env.VERCEL_ENV !== "preview") return false;
  const prod = String(env.VERCEL_PROJECT_PRODUCTION_URL || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!prod) return false;
  try {
    return new URL(origin).host === prod;
  } catch {
    return true;
  }
}

export function publicOrigin(request, env = {}) {
  const configured = String(env.JOEHUB_PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if (configured) {
    if (previewUsesProduction(env, configured)) return "";
    return configured;
  }
  if (env.VERCEL === "1") {
    const proto = header(request, "x-forwarded-proto");
    const host = header(request, "x-forwarded-host");
    if ((proto === "https" || proto === "http") && host && !host.includes("/") && !host.includes("@")) {
      const origin = `${proto}://${host}`;
      if (previewUsesProduction(env, origin)) return "";
      return origin;
    }
    return "";
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
