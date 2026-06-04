import test from 'node:test';
import assert from 'node:assert/strict';

import { ProviderRegistry } from '../providers/registry';
import type { ProviderSecrets } from '../providers/secrets';
import type { ProviderId } from '../providers/types';
import { EnvironmentDetector } from '../EnvironmentDetector';
import { __test } from './stubs/vscode';

const KEY = 'test-key-1234567890';

/** Secrets fake that only returns a key for the listed provider ids. */
function secretsFor(ids: ProviderId[]): ProviderSecrets {
	return {
		get: async (id: ProviderId) => (ids.includes(id) ? KEY : undefined),
		set: async () => {},
		clear: async () => {},
		migrateFromSettings: async () => ({ migrated: [] }),
	} as unknown as ProviderSecrets;
}

function setProvider(value: string): void {
	__test.config['vibeCheck.modelProvider'] = value;
}

test.beforeEach(() => {
	__test.reset();
	EnvironmentDetector.reset();
});

test('explicit available provider is primary with no fallback', async () => {
	setProvider('openai');
	const reg = new ProviderRegistry(secretsFor(['openai']));
	const { providers, usedFallback } = await reg.resolveCandidates();
	assert.equal(providers[0].id, 'openai');
	assert.equal(usedFallback, null);
});

test('explicit unavailable provider falls back to another configured key', async () => {
	setProvider('openai'); // user picked OpenAI…
	const reg = new ProviderRegistry(secretsFor(['anthropic'])); // …but only Anthropic has a key
	const { providers, usedFallback } = await reg.resolveCandidates();
	assert.equal(providers[0].id, 'anthropic');
	assert.equal(usedFallback, 'openai');
	// The list must still contain only available providers.
	assert.ok(providers.every((p) => p.id === 'anthropic'));
});

test('auto mode prefers host providers, then any direct key', async () => {
	setProvider('auto');
	const reg = new ProviderRegistry(secretsFor(['anthropic', 'gemini']));
	const { providers, usedFallback } = await reg.resolveCandidates();
	assert.equal(usedFallback, null);
	// copilot/antigravity unavailable in the stub host → first available direct key wins.
	assert.equal(providers[0].id, 'anthropic');
	assert.deepEqual(
		providers.map((p) => p.id),
		['anthropic', 'gemini']
	);
});

test('full fallback chain: every available provider is offered, in priority order', async () => {
	setProvider('auto');
	const reg = new ProviderRegistry(secretsFor(['gemini', 'openai', 'openrouter', 'anthropic']));
	const { providers } = await reg.resolveCandidates();
	assert.deepEqual(
		providers.map((p) => p.id),
		['anthropic', 'openai', 'openrouter', 'gemini']
	);
});

test('explicit pick is not duplicated in the fallback list', async () => {
	setProvider('anthropic');
	const reg = new ProviderRegistry(secretsFor(['anthropic', 'openai']));
	const { providers } = await reg.resolveCandidates();
	const anthropicCount = providers.filter((p) => p.id === 'anthropic').length;
	assert.equal(anthropicCount, 1);
	assert.equal(providers[0].id, 'anthropic');
});

test('Copilot becomes the host fallback when no API keys exist', async () => {
	setProvider('openai');
	__test.lmModels = [{ family: 'gpt-4o', vendor: 'copilot' }];
	const reg = new ProviderRegistry(secretsFor([])); // no direct keys at all
	const { providers, usedFallback } = await reg.resolveCandidates();
	assert.equal(providers[0].id, 'copilot');
	assert.equal(usedFallback, 'openai');
});

test('no provider available throws an actionable error', async () => {
	setProvider('auto');
	const reg = new ProviderRegistry(secretsFor([]));
	await assert.rejects(() => reg.resolveCandidates(), /No language model is available/);
});

test('resolveActive returns the primary and maps auto-fallback to null', async () => {
	setProvider('auto');
	const reg = new ProviderRegistry(secretsFor(['openai']));
	const { provider, usedFallback } = await reg.resolveActive();
	assert.equal(provider.id, 'openai');
	assert.equal(usedFallback, null);
});
