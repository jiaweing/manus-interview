"use client";

import { useEffect, useState } from "react";

type Boot = { secure: boolean; origin: string };

export default function Home() {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    setBoot({ secure: window.isSecureContext, origin: window.location.origin });
  }, []);

  return (
    <main>
      <h1>Glassroom</h1>
      <p data-testid="boot-status">
        {boot ? (boot.secure ? "secure context" : "insecure context") : "starting"}
      </p>
    </main>
  );
}
