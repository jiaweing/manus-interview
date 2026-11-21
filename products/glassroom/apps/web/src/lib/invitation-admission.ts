import type { SignalingRole } from "./crypto/signaling";
import { admissionEnvelope } from "./invitations";

export type AdmissionStatus =
	| "connecting"
	| "waiting"
	| "peer-present"
	| "room-full"
	| "connection-error"
	| "ended";

/** Admission only; encrypted signaling/WebRTC integration belongs to later issues. */
export function openInvitationAdmission(
	roomId: string,
	role: SignalingRole,
	onStatus: (status: AdmissionStatus) => void,
	onEnd: () => void
): () => void {
	const socket = new WebSocket(`wss://${window.location.host}/signal`);
	let admitted = false;
	let ended = false;
	let failed = false;
	const end = () => {
		if (!ended) {
			ended = true;
			onEnd();
		}
	};
	const fail = () => {
		failed = true;
		onStatus("connection-error");
		end();
		socket.close();
	};
	socket.onopen = () => socket.send(admissionEnvelope(roomId, role));
	socket.onmessage = (event) => {
		if (ended) {
			return;
		}
		try {
			const frame = JSON.parse(String(event.data));
			if (frame.type === "ready") {
				return;
			}
			if (
				frame.type === "joined" &&
				frame.version === 1 &&
				frame.roomId === roomId &&
				frame.role === role
			) {
				admitted = true;
				onStatus(role === "creator" ? "waiting" : "peer-present");
			} else if (frame.type === "peer-joined" && admitted) {
				onStatus("peer-present");
			} else if (frame.type === "terminated") {
				onStatus("ended");
				end();
			} else {
				fail();
			}
		} catch {
			fail();
		}
	};
	socket.onerror = fail;
	socket.onclose = (event) => {
		if (!(ended || failed)) {
			// #132 intentionally uses 1008 for both a full room and a missing room.
			onStatus(
				!admitted && role === "joiner" && event.code === 1008
					? "room-full"
					: admitted
						? "ended"
						: "connection-error"
			);
		}
		end();
	};
	return () => {
		socket.onopen = null;
		socket.onmessage = null;
		socket.onerror = null;
		socket.onclose = null;
		end();
		socket.close();
	};
}
