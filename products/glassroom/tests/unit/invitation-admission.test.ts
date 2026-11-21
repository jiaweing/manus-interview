import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type AdmissionStatus,
	openInvitationAdmission,
} from "../../apps/web/src/lib/invitation-admission";

const ROOM = "AAAAAAAAAAAAAAAAAAAAAA";
const nativeSocket = globalThis.WebSocket;
const nativeWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class AdmissionSocket {
	static readonly OPEN = 1;
	static latest: AdmissionSocket;
	readyState = 0;
	closeCalls = 0;
	throwOnSend = false;
	readonly url: string;
	readonly sent: string[] = [];
	onopen: ((event: Event) => unknown) | null = null;
	onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
	onerror: ((event: Event) => unknown) | null = null;
	onclose: ((event: CloseEvent) => unknown) | null = null;

	constructor(url: string) {
		this.url = url;
		AdmissionSocket.latest = this;
	}

	send(frame: string) {
		// biome-ignore lint/suspicious/noUnnecessaryConditions: Tests mutate the mock's failure flag before the open callback sends.
		if (this.throwOnSend) {
			throw new Error("send failed");
		}
		this.sent.push(frame);
	}

	close() {
		this.closeCalls += 1;
		this.readyState = 2;
	}
}

beforeEach(() => {
	globalThis.WebSocket = AdmissionSocket as unknown as typeof WebSocket;
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { host: "localhost" } },
	});
});

afterEach(() => {
	globalThis.WebSocket = nativeSocket;
	if (nativeWindow) {
		Object.defineProperty(globalThis, "window", nativeWindow);
	} else {
		Reflect.deleteProperty(globalThis, "window");
	}
});

function creator() {
	const statuses: AdmissionStatus[] = [];
	let ends = 0;
	const dispose = openInvitationAdmission(
		ROOM,
		"creator",
		(status) => statuses.push(status),
		() => {
			ends += 1;
		}
	);
	return {
		dispose,
		endCount: () => ends,
		socket: AdmissionSocket.latest,
		statuses,
	};
}

describe("invitation admission lifecycle", () => {
	test("creator reaches waiting after one public admission", () => {
		const { socket, statuses, dispose, endCount } = creator();
		socket.readyState = AdmissionSocket.OPEN;
		socket.onopen?.(new Event("open"));
		expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
			{ operation: "join", role: "creator", roomId: ROOM, version: 1 },
		]);
		socket.onmessage?.(
			new MessageEvent("message", {
				data: JSON.stringify({
					role: "creator",
					roomId: ROOM,
					type: "joined",
					version: 1,
				}),
			})
		);
		expect(statuses).toEqual(["waiting"]);
		dispose();
		dispose();
		expect(socket.closeCalls).toBe(1);
		expect(endCount()).toBe(1);
	});

	test("disposal before open is terminal and ignores captured late callbacks", () => {
		const { socket, statuses, dispose, endCount } = creator();
		const lateOpen = socket.onopen;
		const lateError = socket.onerror;
		dispose();
		dispose();
		socket.readyState = AdmissionSocket.OPEN;
		lateOpen?.(new Event("open"));
		lateError?.(new Event("error"));
		expect(socket.sent).toEqual([]);
		expect(statuses).toEqual([]);
		expect(socket.closeCalls).toBe(1);
		expect(endCount()).toBe(1);
		expect([
			socket.onopen,
			socket.onmessage,
			socket.onerror,
			socket.onclose,
		]).toEqual([null, null, null, null]);
	});

	test("a queued open callback cannot send on a closing socket", () => {
		const { socket, dispose } = creator();
		socket.readyState = 2;
		socket.onopen?.(new Event("open"));
		expect(socket.sent).toEqual([]);
		dispose();
	});

	test("send failure ends once rather than leaving connecting forever", () => {
		const { socket, statuses, dispose, endCount } = creator();
		socket.readyState = AdmissionSocket.OPEN;
		socket.throwOnSend = true;
		socket.onopen?.(new Event("open"));
		socket.onerror?.(new Event("error"));
		expect(statuses).toEqual(["connection-error"]);
		expect(endCount()).toBe(1);
		dispose();
		expect(endCount()).toBe(1);
	});
});
