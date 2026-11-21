import net from "node:net";

function denyNetwork(): never {
	throw new Error("Network services are forbidden in the empty CLI boot test.");
}

Bun.serve = denyNetwork as typeof Bun.serve;
Bun.connect = denyNetwork as typeof Bun.connect;
globalThis.fetch = Object.assign(denyNetwork, { preconnect: denyNetwork });
net.connect = denyNetwork as typeof net.connect;
net.createConnection = denyNetwork as typeof net.createConnection;
net.Server.prototype.listen = denyNetwork as typeof net.Server.prototype.listen;
