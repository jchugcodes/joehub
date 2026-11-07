import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // fixtures.mjs reads this file with a URL next to the module. The tracer
  // does not always follow that read, so the standalone output includes it
  // for the routes that serve or render the synthetic rows.
  outputFileTracingIncludes: {
    "/api/finance/accounts": ["./lib/fixtures.json"],
    "/api/finance/transactions": ["./lib/fixtures.json"],
    "/api/jobs/applications": ["./lib/fixtures.json"],
    "/api/jobs/statuses": ["./lib/fixtures.json"],
    "/api/journal/entries": ["./lib/fixtures.json"],
    "/api/journal/events": ["./lib/fixtures.json"],
    "/finance/accounts": ["./lib/fixtures.json"],
  },
};

export default nextConfig;
