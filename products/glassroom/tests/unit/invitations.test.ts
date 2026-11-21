import { describe, expect, test } from "bun:test";
import {
	admissionEnvelope,
	createInvitation,
	invitationUrl,
	parseInvitation,
} from "../../apps/web/src/lib/invitations";

const ROOM = "AAAAAAAAAAAAAAAAAAAAAA";
const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("client invitations", () => {
	test("fresh room IDs and secrets have exact decoded lengths", () => {
		const first = createInvitation();
		const second = createInvitation();
		expect(Buffer.from(first.roomId, "base64url").byteLength).toBe(16);
		expect(first.secret.byteLength).toBe(32);
		expect(first.roomId).not.toBe(second.roomId);
		expect(first.secret).not.toEqual(second.secret);
		const url = new URL(invitationUrl(first, "https://localhost"));
		const parsed = parseInvitation(url.pathname, url.hash);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.invitation.secret).toEqual(first.secret);
		}
	});

	test("missing fragment and empty secret are local missing errors", () => {
		for (const hash of ["", "#s="]) {
			expect(parseInvitation(`/r/${ROOM}`, hash)).toEqual({
				error: "missing",
				ok: false,
			});
		}
	});

	test("reject malformed and noncanonical room IDs", () => {
		for (const path of [
			"/r/short",
			`/r/${ROOM}=`,
			`/r/${ROOM.slice(0, -1)}B`,
			`/r/${ROOM}/`,
		]) {
			expect(parseInvitation(path, `#s=${SECRET}`)).toEqual({
				error: "invalid",
				ok: false,
			});
		}
	});

	test("reject malformed, padded, duplicate, encoded, and noncanonical secrets", () => {
		for (const hash of [
			"#s=short",
			`#s=${SECRET}=`,
			`#s=${SECRET.slice(0, -1)}B`,
			`#s=${SECRET}&s=${SECRET}`,
			`#s=%41${SECRET.slice(1)}`,
			`#other=${SECRET}`,
		]) {
			expect(parseInvitation(`/r/${ROOM}`, hash)).toEqual({
				error: "invalid",
				ok: false,
			});
		}
	});

	test("admission contains only public fields", () => {
		for (const role of ["creator", "joiner"] as const) {
			expect(JSON.parse(admissionEnvelope(ROOM, role))).toEqual({
				operation: "join",
				role,
				roomId: ROOM,
				version: 1,
			});
		}
	});
});
