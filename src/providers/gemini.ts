import { CompleteOptions, LLMProvider, LLMRequest, PROVIDER_KEY_URLS } from './types';
import { ProviderSecrets } from './secrets';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements LLMProvider {
	readonly id = 'gemini' as const;
	readonly label = 'Google Gemini direct';
	readonly requiresApiKey = true;
	readonly defaultModel = 'gemini-2.5-flash';
	readonly getKeyUrl = PROVIDER_KEY_URLS.gemini;

	constructor(private secrets: ProviderSecrets) {}

	async isAvailable(): Promise<boolean> {
		const key = await this.secrets.get(this.id);
		return !!key && key.length > 10;
	}

	async complete(req: LLMRequest, opts?: CompleteOptions): Promise<string> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			throw new Error('Gemini API key not set. Run "Vibe Check: Set API Key…".');
		}
		const model = (opts?.model && opts.model.trim()) || this.defaultModel;
		const body = {
			contents: [{ role: 'user', parts: [{ text: req.user }] }],
			systemInstruction: { parts: [{ text: req.system }] },
			generationConfig: {
				maxOutputTokens: req.maxTokens ?? 1024,
				temperature: 0.7,
			},
		};
		const res = await fetch(
			`${API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: opts?.signal,
			}
		);
		if (!res.ok) {
			throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => res.statusText)}`);
		}
		const json = (await res.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
		};
		const text =
			json.candidates?.[0]?.content?.parts
				?.map((p) => p.text)
				.filter((s): s is string => !!s)
				.join('') ?? '';
		if (!text) {
			throw new Error('Gemini response had no text content.');
		}
		return text;
	}

	async listModels(): Promise<string[]> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			return this.curatedModels();
		}
		const res = await fetch(`${API}/models?key=${encodeURIComponent(key)}&pageSize=200`);
		if (!res.ok) {
			throw new Error(`Gemini /models ${res.status}`);
		}
		const json = (await res.json()) as {
			models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
		};
		const ids = (json.models ?? [])
			.filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
			.map((m) => m.name?.replace(/^models\//, ''))
			.filter((s): s is string => !!s);
		return ids.length ? ids : this.curatedModels();
	}

	curatedModels(): string[] {
		return [
			'gemini-3.1-pro-preview',
			'gemini-3-flash-preview',
			'gemini-2.5-pro',
			'gemini-2.5-flash',
			'gemini-2.5-flash-lite',
		];
	}
}
