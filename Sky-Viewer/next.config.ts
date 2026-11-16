import type { NextConfig } from "next";

const lookupApiUrl = process.env.LOOKUP_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/targets", destination: `${lookupApiUrl}/targets` },
      { source: "/api/resolve", destination: `${lookupApiUrl}/resolve` },
      { source: "/api/horizons/path", destination: `${lookupApiUrl}/horizons/path` },
      { source: "/api/horizons", destination: `${lookupApiUrl}/horizons` },
      { source: "/api/catalogs", destination: `${lookupApiUrl}/catalogs` },
      { source: "/api/explain", destination: `${lookupApiUrl}/explain` },
      { source: "/api/classify", destination: `${lookupApiUrl}/classify` },
      { source: "/api/explain", destination: `${lookupApiUrl}/explain` },
      { source: "/api/point/cache", destination: `${lookupApiUrl}/point/cache` },
      { source: "/api/point/image", destination: `${lookupApiUrl}/point/image` },
      { source: "/api/point/jobs", destination: `${lookupApiUrl}/point/jobs` },
      { source: "/api/point/jobs/:jobId", destination: `${lookupApiUrl}/point/jobs/:jobId` },
      { source: "/api/point", destination: `${lookupApiUrl}/point` },
    ];
  },
};

export default nextConfig;