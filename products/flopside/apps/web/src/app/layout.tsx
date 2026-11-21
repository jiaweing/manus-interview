import type { Metadata } from "next";
import "../index.css";

export const metadata: Metadata = {
	description: "Play-money poker for friends. Scaffold boot milestone.",
	title: "Flopside",
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
