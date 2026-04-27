import { EnvironmentDetector } from '../EnvironmentDetector';
import { CompleteOptions, LLMProvider, LLMRequest } from './types';

export class AntigravityProvider implements LLMProvider {
	readonly id = 'antigravity' as const;
	readonly label = 'Antigravity AI';
	readonly requiresApiKey = false;
	readonly defaultModel = 'gemini-3-flash';

	async isAvailable(): Promise<boolean> {
		if (EnvironmentDetector.detect() !== 'antigravity') {
			return false;
		}
		const ag = EnvironmentDetector.getAntigravity();
		return !!ag?.ai?.generateText;
	}

	async complete(req: LLMRequest, opts?: CompleteOptions): Promise<string> {
		const ag = EnvironmentDetector.getAntigravity();
		if (!ag?.ai?.generateText) {
			throw new Error('Antigravity AI API unavailable.');
		}
		const out = await ag.ai.generateText({
			model: (opts?.model && opts.model.trim()) || this.defaultModel,
			prompt: `${req.system}\n\n---\n\n${req.user}`,
		});
		return out.text;
	}

	curatedModels(): string[] {
		return ['gemini-3-flash', 'gemini-3-pro'];
	}
}
