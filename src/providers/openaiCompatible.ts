import { CompleteOptions, LLMProvider, LLMRequest, PROVIDER_KEY_URLS } from './types';
import { ProviderSecrets } from './secrets';

interface Config {
	id: 'openai' | 'openrouter';
	label: string;
	defaultModel: string;
	baseUrl: string;
	getKeyUrl: string | undefined;
	curated: string[];
	extraHeaders?: () => Record<string, string>;
}

export class OpenAICompatibleProvider implements LLMProvider {
	readonly id: 'openai' | 'openrouter';
	readonly label: string;
	readonly requiresApiKey = true;
	readonly defaultModel: string;
	readonly getKeyUrl?: string;

	private readonly baseUrl: string;
	private readonly curated: string[];
	private readonly extraHeaders: () => Record<string, string>;

	constructor(
		private secrets: ProviderSecrets,
		cfg: Config
	) {
		this.id = cfg.id;
		this.label = cfg.label;
		this.defaultModel = cfg.defaultModel;
		this.baseUrl = cfg.baseUrl;
		this.getKeyUrl = cfg.getKeyUrl;
		this.curated = cfg.curated;
		this.extraHeaders = cfg.extraHeaders ?? (() => ({}));
	}

	async isAvailable(): Promise<boolean> {
		const key = await this.secrets.get(this.id);
		return !!key && key.length > 10;
	}

	async complete(req: LLMRequest, opts?: CompleteOptions): Promise<string> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			throw new Error(`${this.label} API key not set. Run "Vibe Check: Set API Key…".`);
		}
		const model = (opts?.model && opts.model.trim()) || this.defaultModel;
		const body = {
			model,
			max_tokens: req.maxTokens ?? 1024,
			temperature: 0.7,
			messages: [
				{ role: 'system', content: req.system },
				{ role: 'user', content: req.user },
			],
		};
		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'content-type': 'application/json',
				...this.extraHeaders(),
			},
			body: JSON.stringify(body),
			signal: opts?.signal,
		});
		if (!res.ok) {
			throw new Error(
				`${this.label} ${res.status}: ${await res.text().catch(() => res.statusText)}`
			);
		}
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = json.choices?.[0]?.message?.content ?? '';
		if (!text) {
			throw new Error(`${this.label} response had no text content.`);
		}
		return text;
	}

	async listModels(): Promise<string[]> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			return this.curated;
		}
		const res = await fetch(`${this.baseUrl}/models`, {
			headers: {
				Authorization: `Bearer ${key}`,
				...this.extraHeaders(),
			},
		});
		if (!res.ok) {
			throw new Error(`${this.label} /models ${res.status}`);
		}
		const json = (await res.json()) as { data?: Array<{ id?: string }> };
		const ids = (json.data ?? []).map((m) => m.id).filter((s): s is string => !!s);
		return ids.length ? ids : this.curated;
	}

	curatedModels(): string[] {
		return this.curated;
	}
}

export function createOpenAIProvider(secrets: ProviderSecrets): OpenAICompatibleProvider {
	return new OpenAICompatibleProvider(secrets, {
		id: 'openai',
		label: 'OpenAI',
		defaultModel: 'gpt-5.4-mini',
		baseUrl: 'https://api.openai.com/v1',
		getKeyUrl: PROVIDER_KEY_URLS.openai,
		curated: [
			'gpt-5.5',
			'gpt-5.5-pro',
			'gpt-5.4',
			'gpt-5.4-mini',
			'gpt-5.4-nano',
			'gpt-5',
			'gpt-5-mini',
			'gpt-5-chat-latest',
			'gpt-4.1',
			'gpt-4.1-mini',
			'gpt-4o',
			'gpt-4o-mini',
			'o3-mini',
		],
	});
}

export function createOpenRouterProvider(secrets: ProviderSecrets): OpenAICompatibleProvider {
	return new OpenAICompatibleProvider(secrets, {
		id: 'openrouter',
		label: 'OpenRouter',
		defaultModel: 'anthropic/claude-sonnet-4-6',
		baseUrl: 'https://openrouter.ai/api/v1',
		getKeyUrl: PROVIDER_KEY_URLS.openrouter,
		curated: [
			'anthropic/claude-opus-4-7',
			'anthropic/claude-sonnet-4-6',
			'anthropic/claude-haiku-4-5',
			'openai/gpt-5.5',
			'openai/gpt-5.4-mini',
			'openai/gpt-5',
			'google/gemini-3.1-pro-preview',
			'google/gemini-3-flash-preview',
			'google/gemini-2.5-flash',
			'deepseek/deepseek-v3.2',
			'qwen/qwen3-coder-480b',
			'meta-llama/llama-3.3-70b-instruct',
			'xiaomi/mimo-v2-pro',
		],
		extraHeaders: () => ({
			'HTTP-Referer': 'https://github.com/vibe-check',
			'X-Title': 'Vibe Check',
		}),
	});
}
