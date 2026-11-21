import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("OK"));

export default {
	fetch: app.fetch,
	port: Number(process.env.PORT ?? 8787),
};
