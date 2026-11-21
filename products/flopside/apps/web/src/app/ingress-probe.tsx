"use client";

import { useEffect, useState } from "react";

interface Evidence {
	bootMarker: string;
	connections: number;
}

// TEMPORARY #28 transport evidence UI; #49 removes/replaces with authenticated play.
// No commands, reconnection loop, polling or local-game fallback.
export function IngressProbe() {
	const [status, setStatus] = useState("Connecting");
	const [evidence, setEvidence] = useState<Evidence | null>(null);
	useEffect(() => {
		const url = new URL(
			"/api/ws",
			process.env.NEXT_PUBLIC_SERVER_URL || window.location.href
		);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url);
		socket.onopen = () => setStatus("Open");
		socket.onmessage = (event) => {
			setEvidence(JSON.parse(event.data) as Evidence);
		};
		socket.onerror = () => setStatus("Failed — WebSocket ingress blocked");
		socket.onclose = () => setStatus("Closed — WebSocket ingress blocked");
		return () => socket.close();
	}, []);
	return (
		<section
			aria-label="Temporary WebSocket ingress probe"
			className="mt-8 rounded-[10px] bg-[#F4F4F5] p-6"
		>
			<h2 className="font-semibold text-lg">Temporary transport-only probe</h2>
			<p className="mt-2">
				No gameplay or credentials. Must be replaced before release (#49).
			</p>
			<dl className="mt-4 space-y-2">
				<div>
					<dt>WebSocket /api/ws</dt>
					<dd data-testid="ws-status">{status}</dd>
				</div>
				<div>
					<dt>Public boot marker</dt>
					<dd className="break-all" data-testid="boot-marker">
						{evidence?.bootMarker ?? "Waiting"}
					</dd>
				</div>
				<div>
					<dt>Live connections on this instance</dt>
					<dd data-testid="connection-count">{evidence?.connections ?? 0}</dd>
				</div>
			</dl>
		</section>
	);
}
