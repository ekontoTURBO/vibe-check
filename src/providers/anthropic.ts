import { CompleteOptions, LLMProvider, LLMRequest, PROVIDER_KEY_URLS } from './types';
import { ProviderSecrets } from './secrets';

const API = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider implements LLMProvider {
	readonly id = 'anthropic' as const;
	readonly label = 'Anthropic (Claude direct)';
	readonly requiresApiKey = true;
	readonly defaultModel = 'claude-sonnet-4-6';
	readonly getKeyUrl = PROVIDER_KEY_URLS.anthropic;

	constructor(private secrets: ProviderSecrets) {}

	async isAvailable(): Promise<boolean> {
		const key = await this.secrets.get(this.id);
		return !!key && key.length > 10;
	}

	async complete(req: LLMRequest, opts?: CompleteOptions): Promise<string> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			throw new Error('Anthropic API key not set. Run "Vibe Check: Set API Key…".');
		}
		const model = (opts?.model && opts.model.trim()) || this.defaultModel;
		const body = {
			model,
			max_tokens: req.maxTokens ?? 1024,
			system: req.system,
			messages: [{ role: 'user', content: req.user }],
		};
		const res = await fetch(`${API}/messages`, {
			method: 'POST',
			headers: {
				'x-api-key': key,
				'anthropic-version': ANTHROPIC_VERSION,
				'content-type': 'application/json',
			},
			body: JSON.stringify(body),
			signal: opts?.signal,
		});
		if (!res.ok) {
			throw new Error(`Anthropic ${res.status}: ${await res.text().catch(() => res.statusText)}`);
		}
		const json = (await res.json()) as {
			content?: Array<{ type: string; text?: string; thinking?: string }>;
			stop_reason?: string;
		};
		// Filter to ONLY `type: text` blocks. This explicitly excludes
		// `thinking` blocks (Claude 4.x extended thinking) and any future
		// non-text block types. Mirrors the Gemini fix for `thought: true`.
		const text = (json.content ?? [])
			.filter((c) => c.type === 'text' && typeof c.text === 'string')
			.map((c) => c.text!)
			.join('');
		if (!text) {
			const reason = json.stop_reason;
			if (reason === 'max_tokens') {
				throw new Error(
					'Claude ran out of tokens before producing visible content (extended thinking may have consumed the budget). Try a non-thinking model like `claude-haiku-4-5`.'
				);
			}
			if (reason === 'refusal') {
				throw new Error(
					'Claude refused to answer for this content. Try a different code selection or model.'
				);
			}
			throw new Error(`Anthropic response had no text content (stop_reason: ${reason ?? 'unknown'}).`);
		}
		return text;
	}

	async listModels(): Promise<string[]> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			return this.curatedModels();
		}
		const res = await fetch(`${API}/models?limit=1000`, {
			headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
		});
		if (!res.ok) {
			throw new Error(`Anthropic /models ${res.status}`);
		}
		const json = (await res.json()) as { data?: Array<{ id?: string }> };
		const ids = (json.data ?? []).map((m) => m.id).filter((s): s is string => !!s);
		return ids.length ? ids : this.curatedModels();
	}

	curatedModels(): string[] {
		return [
			'claude-opus-4-7',
			'claude-opus-4-6',
			'claude-sonnet-4-6',
			'claude-haiku-4-5',
			'claude-opus-4-5',
			'claude-3-7-sonnet-latest',
			'claude-3-5-sonnet-latest',
			'claude-3-5-haiku-latest',
		];
	}
}
