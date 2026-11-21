import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	env: {
		// Production always uses the page's origin. Next rewrites do not proxy WS.
		NEXT_PUBLIC_SERVER_URL:
			process.env.NODE_ENV === "development"
				? (process.env.NEXT_PUBLIC_SERVER_URL ??
					`http://${process.env.HOST ?? "127.0.0.1"}:${process.env.SERVER_PORT ?? process.env.PORT ?? 3001}`)
				: "",
	},
	output: "export",
	reactCompiler: true,
	typedRoutes: true,
};

export default nextConfig;
