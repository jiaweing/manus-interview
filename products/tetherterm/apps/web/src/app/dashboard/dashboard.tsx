"use client";
import type { models } from "@polar-sh/sdk/2026-10";
import { Button } from "@tetherterm/ui/components/button";

import { authClient } from "@/lib/auth-client";

export default function Dashboard({
  customerState,
  session,
}: {
  customerState: models.CustomerState | null | undefined;
  session: typeof authClient.$Infer.Session;
}) {
  const hasProSubscription = (customerState?.active_subscriptions?.length ?? 0) > 0;

  return (
    <>
      <p>Plan: {hasProSubscription ? "Pro" : "Free"}</p>
      {hasProSubscription ? (
        <Button onClick={async () => await authClient.customer.portal()}>
          Manage Subscription
        </Button>
      ) : (
        <Button onClick={async () => await authClient.checkout({ slug: "pro" })}>
          Upgrade to Pro
        </Button>
      )}
    </>
  );
}
