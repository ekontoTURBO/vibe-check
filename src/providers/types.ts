export type ProviderId =
	| 'copilot'
	| 'antigravity'
	| 'anthropic'
	| 'gemini'
	| 'openai'
	| 'openrouter';

export const DIRECT_PROVIDERS: ProviderId[] = ['anthropic', 'gemini', 'openai', 'openrouter'];

export const ALL_PROVIDERS: ProviderId[] = [
	'copilot',
	'antigravity',
	'anthropic',
	'gemini',
	'openai',
	'openrouter',
];

export interface LLMRequest {
	system: string;
	user: string;
	maxTokens?: number;
}

export interface CompleteOptions {
	model?: string;
	signal?: AbortSignal;
}

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	requiresApiKey: boolean;
	defaultModel: string;
	getKeyUrl?: string;
}

export interface LLMProvider extends ProviderInfo {
	/** Cheap availability probe (e.g. did the user set the key, is the host correct). */
	isAvailable(): Promise<boolean>;
	complete(req: LLMRequest, opts?: CompleteOptions): Promise<string>;
	/** Optional. Returns model ids; throws on auth/network failure. */
	listModels?(): Promise<string[]>;
	/** Curated fallback list for the picker when listModels is unavailable. */
	curatedModels(): string[];
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
	copilot: 'VS Code LM (Copilot / Antigravity / Cursor built-in AI)',
	antigravity: 'Antigravity AI (legacy globalThis hook)',
	anthropic: 'Anthropic (Claude direct)',
	gemini: 'Google Gemini direct',
	openai: 'OpenAI direct',
	openrouter: 'OpenRouter (100+ models, one key)',
};

export const PROVIDER_KEY_URLS: Partial<Record<ProviderId, string>> = {
	anthropic: 'https://console.anthropic.com/settings/keys',
	gemini: 'https://aistudio.google.com/app/apikey',
	openai: 'https://platform.openai.com/api-keys',
	openrouter: 'https://openrouter.ai/keys',
};
