export const DEMO_TOKEN_KEY = "sidekickDemoToken";
const WHITESPACE = /\s/;

export interface SelectedTab {
	id: number;
	title: string;
	url: string;
}

export interface PanelBrowser {
	storage: {
		session: {
			get: (key: string) => Promise<Record<string, unknown>>;
			set: (items: Record<string, string>) => Promise<void>;
			remove: (key: string) => Promise<void>;
		};
	};
	tabs: {
		query: (query: {
			active: true;
			currentWindow: true;
		}) => Promise<{ id?: number; title?: string; url?: string }[]>;
	};
}

/** No all-tab enumeration, DOM observation, or page-value access. */
export async function loadSelectedTab(
	api: PanelBrowser
): Promise<SelectedTab | null> {
	const [tab] = await api.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined) {
		return null;
	}
	return {
		id: tab.id,
		title: tab.title ?? "Untitled tab",
		url: tab.url ?? "URL unavailable",
	};
}

export function isDemoToken(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && !WHITESPACE.test(value)
	);
}

export async function loadDemoToken(api: PanelBrowser): Promise<string> {
	const items = await api.storage.session.get(DEMO_TOKEN_KEY);
	return isDemoToken(items[DEMO_TOKEN_KEY]) ? items[DEMO_TOKEN_KEY] : "";
}

/** Only the bearer token is persisted, only for this browser session. */
export async function saveDemoToken(
	api: PanelBrowser,
	draft: string
): Promise<string> {
	const token = draft.trim();
	if (!isDemoToken(token)) {
		throw new Error("Enter a token without whitespace.");
	}
	await api.storage.session.set({ [DEMO_TOKEN_KEY]: token });
	return token;
}

export async function clearDemoToken(api: PanelBrowser): Promise<void> {
	await api.storage.session.remove(DEMO_TOKEN_KEY);
}

export interface RequestReadiness {
	disclosureAccepted: boolean;
	disclosurePresented: boolean;
	token: string;
}

export function canRequestModel(state: RequestReadiness): boolean {
	return (
		isDemoToken(state.token) &&
		state.disclosurePresented &&
		state.disclosureAccepted
	);
}

/** Future #88 transport must enter through this gate; #80 makes no model calls. */
export function requestAfterDisclosure<T>(
	state: RequestReadiness,
	request: (token: string) => Promise<T>
): Promise<T> {
	if (!canRequestModel(state)) {
		return Promise.reject(
			new Error(
				"Configure a demo token and acknowledge the provider disclosure first."
			)
		);
	}
	return request(state.token);
}
