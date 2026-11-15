import type { NextConfig } from "next";

const lookupApiUrl = process.env.LOOKUP_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/targets", destination: `${lookupApiUrl}/targets` },
      { source: "/api/point/cache", destination: `${lookupApiUrl}/point/cache` },
      { source: "/api/point/image", destination: `${lookupApiUrl}/point/image` },
      { source: "/api/point/jobs", destination: `${lookupApiUrl}/point/jobs` },
      { source: "/api/point/jobs/:jobId", destination: `${lookupApiUrl}/point/jobs/:jobId` },
      { source: "/api/point", destination: `${lookupApiUrl}/point` },
    ];
  },
};

export default nextConfig;