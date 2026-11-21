"use client";

import { useEffect, useState } from "react";

type Boot = { secure: boolean; origin: string };

export default function Home() {
	const [boot, setBoot] = useState<Boot | null>(null);

	useEffect(() => {
		setBoot({ origin: window.location.origin, secure: window.isSecureContext });
	}, []);

	return (
		<main>
			<h1>Glassroom</h1>
			<p data-testid="boot-status">
				{boot
					? boot.secure
						? "secure context"
						: "insecure context"
					: "starting"}
			</p>
		</main>
	);
}
