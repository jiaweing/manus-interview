# Multiplayer PRD research notes

Verified 2026-11-21. Scope intentionally limited to transport and Manus deployment.

- Browser native WebSocket is broadly supported but lacks backpressure; bound snapshot queues and use bufferedAmount. Source: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- The maintained ws library can attach to the same Node HTTP server, handles protocol ping/pong, and recommends heartbeat detection; browser clients use native WebSocket rather than ws. Source: https://github.com/websockets/ws
- Manus webdev skill deployment contract: server capability plus Dockerfile and healthPath supports container serving; PORT must be honored. Container memory is ephemeral and rolling deployments may overlap. WebSocket ingress support is not explicitly guaranteed in the consulted runtime/hosting references; require an early published transport spike and provide HTTP polling against the same authoritative reducer.
- Manus managed Redis reference exposes native REDIS_URL plus Upstash-compatible REST credentials. Use ioredis on the server for shared ephemeral match state and CAS+publish, not an undocumented single-instance assumption. Reference: /home/ubuntu/skills/webdev/references/redis.md
- Managed Redis costs stated in the skill: USD 0.75 monthly if enabled at month-end, USD 0.30 per 100,000 commands, USD 0.045/GB bandwidth, USD 0.375/GB-month storage. Cloud allowance is used first; depleted balance can delete Redis and data. Disclose before enabling; gameplay data is explicitly disposable.
- Hosting references state on-demand may sleep and cold-start; always-on requires membership. Do not assume on-demand has a fixed idle window or evade sleep using artificial keepalive traffic. References: /home/ubuntu/skills/webdev/references/hosting.md and /home/ubuntu/skills/webdev/SKILL.md
