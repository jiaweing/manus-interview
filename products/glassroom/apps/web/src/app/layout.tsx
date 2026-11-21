import type { Metadata } from "next";
import "../index.css";

export const metadata: Metadata = {
	description: "Memory-only, two-person, end-to-end encrypted chat.",
	title: "Glassroom",
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
