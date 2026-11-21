# Ingress evidence (#28)
- `e2e.txt`: exact `bunx playwright test apps/web/tests/ingress.spec.ts --project=chromium` output (exit 0).
- `marker-config.json`: sanitized boot marker, single-instance config, two 101 handshakes.
- `start-single-instance.txt`: one Bun PID, no children, one listener.
- `context-a.png`, `context-b.png`: real production page in two independent contexts.
- `final-*.txt`: tails of install --frozen-lockfile / lint / typecheck / test / build, all exit 0.
- Not verified: published HTTPS/WSS behind TLS, docker build (no docker in sandbox).
