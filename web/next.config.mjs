/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      // Only /embed may be framed by other sites (design doc Feature 15).
      { source: "/embed", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      {
        source: "/((?!embed).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
    ];
  },
};

export default nextConfig;
