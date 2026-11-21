import {
	Indicator as CheckboxIndicator,
	Root as CheckboxRoot,
} from "@radix-ui/react-checkbox";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { PageObserver } from "../../src/components/page-observer";
import {
	canRequestModel,
	clearDemoToken,
	isDemoToken,
	loadDemoToken,
	loadSelectedTab,
	type SelectedTab,
	saveDemoToken,
} from "../../src/panel/config";
import { proxyUrl } from "../../src/proxy";

export default function App() {
	const [selectedTab, setSelectedTab] = useState<SelectedTab | null>(null);
	const [contextStatus, setContextStatus] = useState(
		"Reading selected-tab metadata…"
	);
	const [token, setToken] = useState("");
	const [tokenDraft, setTokenDraft] = useState("");
	const [tokenStatus, setTokenStatus] = useState("Checking session token…");
	const [saving, setSaving] = useState(false);
	const [disclosurePresented, setDisclosurePresented] = useState(false);
	const [disclosureAccepted, setDisclosureAccepted] = useState(false);
	const [goal, setGoal] = useState("");
	const tokenInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let mounted = true;
		let revision = 0;
		let selectedId: number | undefined;
		async function refreshContext() {
			revision += 1;
			const currentRevision = revision;
			try {
				const tab = await loadSelectedTab(browser);
				if (mounted && currentRevision === revision) {
					selectedId = tab?.id;
					setSelectedTab(tab);
					setContextStatus(tab ? "" : "No selected tab is available.");
				}
			} catch {
				if (mounted && currentRevision === revision) {
					selectedId = undefined;
					setSelectedTab(null);
					setContextStatus("Selected-tab metadata is unavailable.");
				}
			}
		}
		function onUpdated(tabId: number) {
			if (tabId === selectedId) {
				refreshContext();
			}
		}
		refreshContext();
		loadDemoToken(browser).then(
			(value) => {
				if (mounted) {
					setToken(value);
					setTokenStatus(
						value
							? "Token configured for this browser session."
							: "No token configured."
					);
				}
			},
			() => {
				if (mounted) {
					setTokenStatus(
						"Session storage is unavailable. No token configured."
					);
				}
			}
		);
		// This effect runs only after the always-visible disclosure has mounted.
		setDisclosurePresented(true);
		browser.tabs.onActivated.addListener(refreshContext);
		browser.tabs.onUpdated.addListener(onUpdated);
		browser.windows.onFocusChanged.addListener(refreshContext);
		return () => {
			mounted = false;
			browser.tabs.onActivated.removeListener(refreshContext);
			browser.tabs.onUpdated.removeListener(onUpdated);
			browser.windows.onFocusChanged.removeListener(refreshContext);
		};
	}, []);

	async function configureToken(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		try {
			const value = await saveDemoToken(browser, tokenDraft);
			setToken(value);
			setTokenDraft("");
			setTokenStatus("Token configured for this browser session.");
			tokenInput.current?.focus();
		} catch {
			setTokenStatus(
				"Could not save the token. Use a token without whitespace and try again."
			);
		} finally {
			setSaving(false);
		}
	}

	async function removeToken() {
		setSaving(true);
		try {
			await clearDemoToken(browser);
			setToken("");
			setTokenDraft("");
			setTokenStatus("Token cleared from this browser session.");
			tokenInput.current?.focus();
		} catch {
			setTokenStatus("Could not clear the token. Try again.");
		} finally {
			setSaving(false);
		}
	}

	function acknowledgeDisclosure(checked: boolean | "indeterminate") {
		setDisclosureAccepted(checked === true);
	}

	function changeTokenDraft(event: React.ChangeEvent<HTMLInputElement>) {
		setTokenDraft(event.target.value);
	}

	function changeGoal(event: React.ChangeEvent<HTMLTextAreaElement>) {
		setGoal(event.target.value);
	}

	const requestReady = canRequestModel({
		disclosureAccepted,
		disclosurePresented,
		token,
	});

	return (
		<main
			className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5"
			data-request-ready={requestReady}
		>
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold">Sidekick</h1>
				<p className="text-neutral-700">
					Supervised browser actions. You stay in control.
				</p>
			</header>

			<section
				aria-labelledby="context-heading"
				className="flex min-w-0 flex-col gap-2"
			>
				<h2 className="font-semibold" id="context-heading">
					Selected tab
				</h2>
				<div className="surface flex min-w-0 flex-col gap-1" role="status">
					{selectedTab ? (
						<>
							<p className="wrap-anywhere font-semibold">{selectedTab.title}</p>
							<p className="wrap-anywhere text-neutral-700">
								{selectedTab.url}
							</p>
						</>
					) : (
						<p>{contextStatus}</p>
					)}
				</div>
			</section>

			<section
				aria-labelledby="disclosure-heading"
				className="surface flex flex-col gap-3"
			>
				<h2 className="font-semibold" id="disclosure-heading">
					Before you use page text
				</h2>
				<p id="provider-disclosure">
					Your task and necessary rendered page text and control labels will be
					sent through the proxy to OpenRouter and its model provider. Their
					retention policies apply; zero retention is not guaranteed. Use dummy
					or non-sensitive data.
				</p>
				<p className="text-neutral-700">
					Tasks and transcripts stay in panel memory. Closing the panel starts
					fresh. Only the demo token is kept for this browser session.
				</p>
				<div className="flex items-start gap-3">
					<CheckboxRoot
						aria-describedby="provider-disclosure"
						checked={disclosureAccepted}
						className="disclosure-checkbox shrink-0"
						id="disclosure-accepted"
						onCheckedChange={acknowledgeDisclosure}
					>
						<CheckboxIndicator aria-hidden="true">✓</CheckboxIndicator>
					</CheckboxRoot>
					<label className="cursor-pointer" htmlFor="disclosure-accepted">
						I understand the provider disclosure.
					</label>
				</div>
			</section>

			<section
				aria-labelledby="token-heading"
				className="flex min-w-0 flex-col gap-2"
			>
				<h2 className="font-semibold" id="token-heading">
					Demo token
				</h2>
				<p className="wrap-anywhere text-neutral-700">Proxy: {proxyUrl}</p>
				<form className="flex flex-col gap-3" onSubmit={configureToken}>
					<label className="font-semibold" htmlFor="demo-token">
						Session token
					</label>
					<input
						aria-describedby="token-status"
						autoComplete="off"
						className="field"
						id="demo-token"
						onChange={changeTokenDraft}
						placeholder="Enter your demo token"
						ref={tokenInput}
						spellCheck={false}
						type="password"
						value={tokenDraft}
					/>
					<div className="flex flex-wrap gap-3">
						<button
							className="button-primary"
							disabled={saving || !isDemoToken(tokenDraft.trim())}
							type="submit"
						>
							Save token
						</button>
						<button
							className="button-secondary"
							disabled={saving || !token}
							onClick={removeToken}
							type="button"
						>
							Clear token
						</button>
					</div>
				</form>
				<p className="text-neutral-700" id="token-status" role="status">
					{tokenStatus}
				</p>
			</section>

			<section aria-labelledby="task-heading" className="flex flex-col gap-2">
				<h2 className="font-semibold" id="task-heading">
					<label htmlFor="task">Task</label>
				</h2>
				<textarea
					aria-describedby="task-help"
					className="field min-h-28 resize-y"
					id="task"
					onChange={changeGoal}
					placeholder="What would you like to do on this page?"
					value={goal}
				/>
				<p className="text-neutral-700" id="task-help">
					{requestReady
						? "Configured. A plan is required before Run."
						: "Configure a token and acknowledge the disclosure before any model request."}
				</p>
			</section>

			<section
				aria-labelledby="plan-heading"
				className="surface flex flex-col gap-3"
			>
				<h2 className="font-semibold" id="plan-heading">
					Plan
				</h2>
				<p id="plan-status">
					No plan yet. Review the plan here before any browser action.
				</p>
				<button
					aria-describedby="plan-status"
					className="button-primary self-start"
					disabled
					type="button"
				>
					Run
				</button>
			</section>

			<section
				aria-labelledby="timeline-heading"
				className="flex flex-col gap-3"
			>
				<div className="flex items-center justify-between gap-3">
					<h2 className="font-semibold" id="timeline-heading">
						Timeline
					</h2>
					<button
						aria-describedby="timeline-status"
						className="button-secondary"
						disabled
						type="button"
					>
						Stop
					</button>
				</div>
				<p className="text-neutral-700" id="timeline-status" role="status">
					No actions have run.
				</p>
			</section>

			<PageObserver />
		</main>
	);
}
