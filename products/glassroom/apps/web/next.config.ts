import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Bun HTTPS origin proxies to Next; it does the connection handling.
  compress: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // Privacy: never log request URLs (they can carry room ids).
  logging: { incomingRequests: false },
};

export default nextConfig;
