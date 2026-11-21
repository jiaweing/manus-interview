import { createInterface } from "node:readline";

// Test-only process. Never imported by production main code.
const mode = process.argv[2];
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line) as { requestId: string; op: string };
  const target = { focus: "0x5678", foreground: "0x1234" };
  const response =
    request.op === "snapshot"
      ? { ok: true, requestId: request.requestId, target }
      : {
          ok: true,
          outcome: mode?.startsWith("outcome-") ? mode.slice(8) : "unsupported",
          requestId: request.requestId,
        };
  switch (mode) {
    case "exit":
      process.exit(17);
      break;
    case "silent":
      break;
    case "malformed":
      process.stdout.write("not-json\n");
      break;
    case "wrong-id":
      process.stdout.write(
        JSON.stringify({ ...response, requestId: "other" }) + "\n"
      );
      break;
    case "null-id":
      process.stdout.write(
        '{"requestId":null,"ok":false,"error":"invalid_request"}\n'
      );
      break;
    case "extra":
      process.stdout.write(
        JSON.stringify({ ...response, command: "extra" }) + "\n"
      );
      break;
    case "wrong-type":
      process.stdout.write(JSON.stringify({ ...response, ok: "true" }) + "\n");
      break;
    case "wrong-op":
      process.stdout.write(
        JSON.stringify({
          ok: true,
          outcome: "unsupported",
          requestId: request.requestId,
        }) + "\n"
      );
      break;
    case "duplicate-key":
      process.stdout.write(
        `{"requestId":"${request.requestId}","ok":true,"ok":true,"target":${JSON.stringify(target)}}\n`
      );
      break;
    case "invalid-utf8":
      process.stdout.write(Buffer.from([0xff, 0x0a]));
      break;
    case "overlong":
      process.stdout.write("x".repeat(65_537));
      break;
    case "truncated":
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
      break;
    case "error":
      process.stdout.write(
        JSON.stringify({
          error: "no_target",
          ok: false,
          requestId: request.requestId,
        }) + "\n"
      );
      break;
    case "split": {
      const data = JSON.stringify(response) + "\n";
      for (const byte of Buffer.from(data)) {
        process.stdout.write(Buffer.from([byte]));
      }
      break;
    }
    default:
      process.stdout.write(JSON.stringify(response) + "\n");
  }
});
