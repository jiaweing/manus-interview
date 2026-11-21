import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("OK"));

export default {
port: Number(process.env.PORT ?? 8787),
fetch: app.fetch,
};
