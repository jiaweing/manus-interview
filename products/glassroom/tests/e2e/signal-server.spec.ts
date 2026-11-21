import { expect, test } from "@playwright/test";
import { SIGNAL_FRAME_CAP_BYTES } from "../../apps/server/src/signal-server";

for (const rejection of ["participant-close", "room-role-spoof", "over-cap"] as const) {
  test(`WSS admission, opaque forwarding, and ${rejection} teardown`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ({ rejection, cap }) => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const roomId = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const url = `wss://${location.host}/signal`;
      async function deadline<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("signal test timeout")), 10_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      async function connect() {
        const ws = new WebSocket(url);
        const messages: string[] = [];
        const readers: ((raw: string) => void)[] = [];
        ws.onmessage = (event) => {
          const reader = readers.shift();
          if (reader) reader(String(event.data));
          else messages.push(String(event.data));
        };
        const closed = new Promise<number>((resolve) => {
          ws.onclose = (event) => resolve(event.code);
        });
        const next = () => deadline(new Promise<string>((resolve) => {
          const queued = messages.shift();
          if (queued !== undefined) resolve(queued);
          else readers.push(resolve);
        }));
        const ready = JSON.parse(await next());
        return { ws, next, closed, ready };
      }
      const join = (role: "creator" | "joiner") => JSON.stringify({
        version: 1, roomId, role, operation: "join",
      });
      const creator = await connect();
      creator.ws.send(join("creator"));
      const creatorAdmission = JSON.parse(await creator.next());
      const joiner = await connect();
      joiner.ws.send(join("joiner"));
      const joinerAdmission = JSON.parse(await joiner.next());
      const peerJoined = JSON.parse(await creator.next());
      const outsiderCodes: number[] = [];
      for (const role of ["creator", "joiner"] as const) {
        const outsider = await connect();
        outsider.ws.send(join(role));
        outsiderCodes.push(await deadline(outsider.closed));
      }
      const envelope = {
        version: 1, roomId, role: "creator", operation: "forward",
        counter: "0", ciphertext: "AAAAAAAAAAAAAAAAAAAAAA",
      };
      const ciphertext = ` \n${JSON.stringify(envelope)}\t `;
      creator.ws.send(ciphertext);
      const forwarded = await joiner.next();
      const reply = JSON.stringify({ ...envelope, role: "joiner", counter: "1" });
      joiner.ws.send(reply);
      const forwardedReply = await creator.next();
      if (rejection === "participant-close") {
        creator.ws.close(1000, "leaving");
      } else {
        creator.ws.send(rejection === "over-cap"
          ? " ".repeat(cap + 1)
          : JSON.stringify({ ...envelope, role: "joiner" }));
      }
      const creatorCode = await deadline(creator.closed);
      const terminated = JSON.parse(await joiner.next());
      const joinerCode = await deadline(joiner.closed);
      const lateJoiner = await connect();
      lateJoiner.ws.send(join("joiner"));
      const lateCode = await deadline(lateJoiner.closed);
      const replacement = await connect();
      replacement.ws.send(join("creator"));
      const replacementAdmission = JSON.parse(await replacement.next());
      replacement.ws.close();
      await deadline(replacement.closed);
      return {
        ready: [creator.ready, joiner.ready], roomId, creatorAdmission, joinerAdmission,
        peerJoined, outsiderCodes, ciphertext, forwarded, reply, forwardedReply,
        creatorCode, terminated, joinerCode, lateCode, replacementAdmission,
      };
    }, { rejection, cap: SIGNAL_FRAME_CAP_BYTES });
    expect(result.ready).toEqual([{ type: "ready" }, { type: "ready" }]);
    expect(result.creatorAdmission).toEqual({ type: "joined", version: 1, roomId: result.roomId, role: "creator" });
    expect(result.joinerAdmission).toEqual({ type: "joined", version: 1, roomId: result.roomId, role: "joiner" });
    expect(result.peerJoined).toEqual({ type: "peer-joined" });
    expect(result.outsiderCodes).toEqual([1008, 1008]);
    expect(result.forwarded).toBe(result.ciphertext);
    expect(result.forwardedReply).toBe(result.reply);
    expect(result.creatorCode).toBe(rejection === "participant-close" ? 1000 : rejection === "over-cap" ? 1009 : 1008);
    expect(result.terminated).toEqual({ type: "terminated" });
    expect(result.joinerCode).toBe(1000);
    expect(result.lateCode).toBe(1008);
    expect(result.replacementAdmission).toEqual({ type: "joined", version: 1, roomId: result.roomId, role: "creator" });
  });
}
