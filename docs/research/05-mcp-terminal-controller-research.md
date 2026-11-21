# Terminal controller research

- Official SDK v1 server docs: stdio and Streamable HTTP supported; structuredContent plus text content; legacy HTTP+SSE deprecated. https://ts.sdk.modelcontextprotocol.io/server.html
- MCP latest transport overview currently points to revision 2026-07-28 and describes per-request metadata, with backward compatibility for initialize/session-era clients. Do not conflate the latest protocol with the v1 examples targeting 2025-11-25. https://modelcontextprotocol.io/specification/latest/basic/transports
- node-pty supplies PTY spawn, onData, write, resize, exit hooks; processes have host-user permissions, not a sandbox. Native compilation can require build tools. https://github.com/microsoft/node-pty
- @xterm/headless runs in Node and maintains terminal state; headless buffer supports a text-screen representation. https://github.com/xtermjs/xterm.js
