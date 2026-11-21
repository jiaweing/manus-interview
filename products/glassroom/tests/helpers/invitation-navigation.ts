import type { Page } from "@playwright/test";

/** Never attach the original error/cause: Playwright includes the full URL. */
export async function gotoInvitation(page: Pick<Page, "goto">, link: string) {
	try {
		await page.goto(link);
	} catch {
		// biome-ignore lint/style/useErrorCause: The original navigation error contains the invitation secret; this is a deliberate redaction boundary.
		throw new Error("Invitation navigation failed (secret redacted).");
	}
}
