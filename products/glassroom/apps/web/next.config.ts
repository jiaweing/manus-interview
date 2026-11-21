import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The Bun HTTPS origin proxies to Next; it does the connection handling.
	compress: false,
	// Privacy: never log request URLs (they can carry room ids).
	logging: { incomingRequests: false },
	poweredByHeader: false,
	reactStrictMode: true,
};

export default nextConfig;
