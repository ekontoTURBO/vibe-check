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
		const generationConfig: Record<string, unknown> = {
			maxOutputTokens: req.maxTokens ?? 1024,
			temperature: 0.7,
		};
		if (req.expectJson) {
			// Forces strict JSON output — no markdown fences, no prose prefix,
			// no single-quoted strings. Documented at:
			// https://ai.google.dev/gemini-api/docs/structured-output
			generationConfig.responseMimeType = 'application/json';
		}
		const body = {
			contents: [{ role: 'user', parts: [{ text: req.user }] }],
			systemInstruction: { parts: [{ text: req.system }] },
			generationConfig,
		};
		// Use header-based auth (`x-goog-api-key`) instead of `?key=...` to keep the
		// API key out of URLs — URLs end up in proxy logs and Node fetch error messages.
		const res = await fetch(
			`${API}/models/${encodeURIComponent(model)}:generateContent`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-goog-api-key': key,
				},
				body: JSON.stringify(body),
				signal: opts?.signal,
			}
		);
		if (!res.ok) {
			throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => res.statusText)}`);
		}
		const json = (await res.json()) as {
			candidates?: Array<{
				content?: { parts?: Array<{ text?: string; thought?: boolean }> };
				finishReason?: string;
				safetyRatings?: Array<{ category?: string; probability?: string }>;
			}>;
			promptFeedback?: { blockReason?: string };
		};

		// 1. Hard block at the prompt level (no candidates ever generated).
		if (!json.candidates || json.candidates.length === 0) {
			const blockReason = json.promptFeedback?.blockReason;
			throw new Error(
				blockReason
					? `Gemini blocked the request (reason: ${blockReason}). Try a smaller selection or different code.`
					: 'Gemini returned no candidates.'
			);
		}

		const candidate = json.candidates[0];
		const finishReason = candidate?.finishReason;

		// 2. Filter out THINKING parts — gemini-2.5-flash has thinking enabled
		//    by default and returns reasoning as parts with `thought: true`. If
		//    we don't filter, the parser sees `<thinking-with-code>{answer}` and
		//    locks onto a `{` inside the thoughts.
		const text =
			candidate?.content?.parts
				?.filter((p) => p.thought !== true)
				.map((p) => p.text)
				.filter((s): s is string => !!s)
				.join('') ?? '';

		if (!text) {
			// 3. Surface WHY there was no text — safety, length, or unknown.
			if (finishReason === 'SAFETY') {
				throw new Error(
					'Gemini blocked the response on safety grounds. Try a different code selection.'
				);
			}
			if (finishReason === 'MAX_TOKENS') {
				throw new Error(
					'Gemini ran out of output tokens before producing any visible content. The thinking budget consumed everything. Try a smaller selection or a non-thinking model (e.g. gemini-2.5-flash-lite).'
				);
			}
			if (finishReason === 'RECITATION') {
				throw new Error(
					'Gemini blocked the response for recitation (close match to training data). Try a different code selection.'
				);
			}
			throw new Error(`Gemini returned no text content (finishReason: ${finishReason ?? 'unknown'}).`);
		}

		// 4. Even with text, MAX_TOKENS during the answer means the JSON is
		//    likely truncated. Annotate so the parser's error is interpretable.
		if (finishReason === 'MAX_TOKENS' && req.expectJson) {
			console.warn(
				'[VibeCheck] Gemini hit MAX_TOKENS — the JSON below is probably truncated. Consider a smaller context or a non-thinking model.'
			);
		}
		return text;
	}

	async listModels(): Promise<string[]> {
		const key = await this.secrets.get(this.id);
		if (!key) {
			return this.curatedModels();
		}
		const res = await fetch(`${API}/models?pageSize=200`, {
			headers: { 'x-goog-api-key': key },
		});
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
