# Local agent harness: scoped source notes

- MCP stdio is JSON-RPC 2.0 over UTF-8 newline-delimited messages. stdout must contain only protocol messages; stderr is the logging channel. Source: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP initialization negotiates a protocol version and capabilities, followed by notifications/initialized. Unsupported negotiated versions should disconnect. Shutdown uses closed stdin followed by bounded SIGTERM/SIGKILL escalation, not an invented shutdown RPC. Source: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
- Node 22 permission controls became non-experimental in 22.13.0. They restrict filesystem, child-process, worker, addon, WASI, and inspector use but do not defend against malicious code. Symlinks can escape allowed filesystem paths. Treat subprocess execution as failure isolation and permissions as accident prevention, never a hostile-code sandbox. Source: https://nodejs.org/docs/latest-v22.x/api/permissions.html

Decision: a portable local CLI, MCP tools-only protocol pinned to 2025-06-18, trusted-source plugin MVP with explicit grants, a real configurable model adapter, and a zero-host-change third-plugin conformance test. Linux is the demo target; hardened OS sandboxing is stretch. No need for desktop packaging, containers, or a marketplace in the one-session build.
