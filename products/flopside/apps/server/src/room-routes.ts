import { Hono } from "hono";
import { z } from "zod";
import { RoomError, type RoomErrorCode, type RoomStore } from "./rooms";

const bodySchema = z.object({ nickname: z.string() }).strict();
const ERROR_STATUS = {
	AUTH_REQUIRED: 403,
	ILLEGAL_ACTION: 400,
	MATCH_STARTED: 409,
	ROOM_EXPIRED: 404,
	ROOM_FULL: 409,
} as const satisfies Record<RoomErrorCode, number>;

export function createRoomRoutes(store: RoomStore) {
	const routes = new Hono();
	routes.onError((error, c) => {
		if (error instanceof RoomError) {
			return c.json({ error: { code: error.code } }, ERROR_STATUS[error.code]);
		}
		// Do not let Hono's default handler log payloads or private state.
		return c.json({ error: { code: "ILLEGAL_ACTION" } }, 500);
	});
	routes.post("/", async (c) => {
		const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) {
			throw new RoomError("ILLEGAL_ACTION");
		}
		return c.json(store.create(parsed.data.nickname), 201);
	});
	routes.post("/:code/join", async (c) => {
		const code = c.req.param("code");
		store.touch(code);
		const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) {
			throw new RoomError("ILLEGAL_ACTION");
		}
		return c.json(store.join(code, parsed.data.nickname), 200);
	});
	return routes;
}
