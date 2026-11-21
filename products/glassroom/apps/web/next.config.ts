import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Bun HTTPS origin proxies to Next; it does the connection handling.
  compress: false,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
