"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SignalingRole } from "../lib/crypto/signaling";
import {
	type AdmissionStatus,
	openInvitationAdmission,
} from "../lib/invitation-admission";
import {
	createInvitation,
	type Invitation,
	type InvitationResult,
	invitationUrl,
	parseInvitation,
} from "../lib/invitations";

type Status = AdmissionStatus | "home" | "starting" | "missing" | "invalid";
const LABELS: Record<Status, string> = {
	connecting: "Connecting to room",
	"connection-error": "Connection failed. Create a fresh room.",
	ended: "Room ended. Create a fresh room; old invitations cannot reconnect.",
	home: "Create a private invitation for one other person.",
	invalid: "Invalid invitation. Ask for a fresh link.",
	missing: "Missing invitation secret. Ask for the complete link.",
	"peer-present": "Peer joined. Identity is not yet verified.",
	"room-full": "Room full or unavailable. Ask for a fresh invitation.",
	starting: "Checking invitation",
	waiting: "Waiting for peer",
};

export default function InvitationRoom({ join = false }: { join?: boolean }) {
	const [status, setStatus] = useState<Status>(join ? "starting" : "home");
	const [secure, setSecure] = useState<boolean | null>(null);
	const [canCopy, setCanCopy] = useState(false);
	const [copyStatus, setCopyStatus] = useState("");
	const invitation = useRef<Invitation | null>(null);
	const initial = useRef<InvitationResult | null>(null);
	const dispose = useRef<(() => void) | null>(null);
	const started = useRef(false);

	const discard = useCallback(() => {
		invitation.current?.secret.fill(0);
		invitation.current = null;
		initial.current = null;
		setCanCopy(false);
		setCopyStatus("");
	}, []);

	const connect = useCallback(
		(value: Invitation, role: SignalingRole) => {
			// biome-ignore lint/suspicious/noUnnecessaryConditions: This callback sets the ref true on its first call; later calls must never reopen admission.
			if (started.current) {
				return;
			}
			started.current = true;
			invitation.current = value;
			setStatus("connecting");
			setCanCopy(role === "creator");
			try {
				dispose.current = openInvitationAdmission(
					value.roomId,
					role,
					setStatus,
					discard
				);
			} catch {
				discard();
				setStatus("connection-error");
			}
		},
		[discard]
	);

	useEffect(() => {
		setSecure(window.isSecureContext);
		if (join && !initial.current) {
			initial.current = parseInvitation(
				window.location.pathname,
				window.location.hash
			);
			// Replace, never push: the secret-bearing entry is not left in Back history.
			window.history.replaceState(null, "", window.location.pathname);
		}
		let cancelled = false;
		const consume = () => {
			if (cancelled || !join) {
				return;
			}
			const parsed = initial.current;
			if (!window.isSecureContext) {
				discard();
				setStatus("connection-error");
			} else if (parsed?.ok) {
				connect(parsed.invitation, "joiner");
			} else {
				setStatus(parsed?.error ?? "invalid");
			}
		};
		// Strict Mode's exploratory effect must not open/tear down a room and reuse it.
		queueMicrotask(consume);
		const onHashChange = () => {
			const hash = window.location.hash;
			window.history.replaceState(null, "", window.location.pathname);
			// biome-ignore lint/suspicious/noUnnecessaryConditions: connect() sets this ref true before opening WSS, including after transport teardown.
			if (started.current || !join) {
				return;
			}
			// Pasting a corrected fragment is a same-document navigation, not a remount.
			initial.current = parseInvitation(window.location.pathname, hash);
			consume();
		};
		const endOnPageHide = () => {
			dispose.current?.();
			dispose.current = null;
			setStatus("ended");
		};
		window.addEventListener("hashchange", onHashChange);
		window.addEventListener("pagehide", endOnPageHide);
		return () => {
			cancelled = true;
			window.removeEventListener("hashchange", onHashChange);
			window.removeEventListener("pagehide", endOnPageHide);
			dispose.current?.();
			dispose.current = null;
		};
	}, [connect, discard, join]);

	function create() {
		if (invitation.current || status !== "home") {
			return;
		}
		try {
			if (!window.isSecureContext) {
				setStatus("connection-error");
				return;
			}
			const value = createInvitation();
			window.history.replaceState(null, "", `/r/${value.roomId}`);
			connect(value, "creator");
		} catch {
			discard();
			setStatus("connection-error");
		}
	}

	async function copy() {
		const value = invitation.current;
		if (!(value && canCopy)) {
			return;
		}
		try {
			await navigator.clipboard.writeText(
				invitationUrl(value, window.location.origin)
			);
			if (invitation.current === value) {
				setCopyStatus("Invitation copied. Share it through a trusted channel.");
			}
		} catch {
			if (invitation.current === value) {
				setCopyStatus("Copy failed. Allow clipboard access and try again.");
			}
		}
	}

	return (
		<main className="invitation-room">
			<h1>Glassroom</h1>
			<p className="security-label">Two people. No account.</p>
			<p data-testid="boot-status">
				{secure === null
					? "starting"
					: secure
						? "secure context"
						: "insecure context"}
			</p>
			<p
				aria-live="polite"
				className="room-status"
				data-status={status}
				role="status"
			>
				{LABELS[status]}
			</p>
			{status === "home" && (
				<button onClick={create} type="button">
					Create room
				</button>
			)}
			{canCopy ? (
				<>
					<button onClick={copy} type="button">
						Copy invitation
					</button>
					<p>
						Only copy when you intend to share. Clipboard sync can expose this
						link.
					</p>
				</>
			) : null}
			<p aria-live="polite">{copyStatus}</p>
			{[
				"missing",
				"invalid",
				"room-full",
				"connection-error",
				"ended",
			].includes(status) && (
				<a className="fresh-room" href="/">
					Create a fresh room
				</a>
			)}
			<p className="invitation-limit">
				Link possession permits joining, not verified identity. Page code and
				extensions can read the link secret. This demo is not an audited secure
				messenger.
			</p>
		</main>
	);
}
