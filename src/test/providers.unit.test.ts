import test from 'node:test';
import assert from 'node:assert/strict';

import { AnthropicProvider } from '../providers/anthropic';
import { GeminiProvider } from '../providers/gemini';
import { createOpenAIProvider, createOpenRouterProvider } from '../providers/openaiCompatible';
import { CopilotProvider } from '../providers/copilot';
import { AntigravityProvider } from '../providers/antigravity';
import { EnvironmentDetector } from '../EnvironmentDetector';
import { __test } from './stubs/vscode';
import type { ProviderSecrets } from '../providers/secrets';

const KEY = 'test-key-1234567890';

/** Fake SecretStorage-backed secrets — returns a fixed key for every provider. */
function fakeSecrets(key: string | undefined = KEY): ProviderSecrets {
	return {
		get: async () => key,
		set: async () => {},
		clear: async () => {},
		migrateFromSettings: async () => ({ migrated: [] }),
	} as unknown as ProviderSecrets;
}

interface Captured {
	url: string;
	init: RequestInit | undefined;
}

/** Install a fake global.fetch that records calls and returns `responder(url, init)`. */
function installFetch(
	responder: (url: string, init: RequestInit | undefined) => unknown
): Captured[] {
	const calls: Captured[] = [];
	(global as unknown as { fetch: unknown }).fetch = async (url: unknown, init: unknown) => {
		calls.push({ url: String(url), init: init as RequestInit });
		return responder(String(url), init as RequestInit);
	};
	return calls;
}

function jsonOk(body: unknown) {
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function httpError(status: number, body: string) {
	return {
		ok: false,
		status,
		statusText: 'ERR',
		json: async () => ({ error: body }),
		text: async () => body,
	};
}

function bodyOf(c: Captured): Record<string, unknown> {
	return JSON.parse(String((c.init as RequestInit).body)) as Record<string, unknown>;
}

function headersOf(c: Captured): Record<string, string> {
	return ((c.init as RequestInit).headers ?? {}) as Record<string, string>;
}

const REQ = { system: 'You are a teacher.', user: 'Make a quiz.' };

test.beforeEach(() => __test.reset());

/* ============================= Anthropic ============================= */

test('Anthropic: correct endpoint, auth header, body shape, and parse', async () => {
	const calls = installFetch(() => jsonOk({ content: [{ type: 'text', text: 'ANSWER' }] }));
	const p = new AnthropicProvider(fakeSecrets());
	const out = await p.complete(REQ, { model: 'claude-sonnet-4-6' });

	assert.equal(out, 'ANSWER');
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
	const h = headersOf(calls[0]);
	assert.equal(h['x-api-key'], KEY);
	assert.equal(h['anthropic-version'], '2023-06-01');
	const body = bodyOf(calls[0]);
	assert.equal(body.model, 'claude-sonnet-4-6');
	assert.equal(body.system, REQ.system);
	assert.deepEqual(body.messages, [{ role: 'user', content: REQ.user }]);
});

test('Anthropic: HTTP error surfaces status code', async () => {
	installFetch(() => httpError(401, 'invalid x-api-key'));
	const p = new AnthropicProvider(fakeSecrets());
	await assert.rejects(() => p.complete(REQ), /401/);
});

test('Anthropic: isAvailable reflects key presence', async () => {
	const withKey = { get: async () => KEY } as unknown as ProviderSecrets;
	const noKey = { get: async () => undefined } as unknown as ProviderSecrets;
	const shortKey = { get: async () => 'short' } as unknown as ProviderSecrets;
	assert.equal(await new AnthropicProvider(withKey).isAvailable(), true);
	assert.equal(await new AnthropicProvider(noKey).isAvailable(), false);
	assert.equal(await new AnthropicProvider(shortKey).isAvailable(), false);
});

/* ============================= Gemini ============================= */

test('Gemini: header-based key, generateContent endpoint, body + parse', async () => {
	const calls = installFetch(() =>
		jsonOk({ candidates: [{ content: { parts: [{ text: 'GEM' }] } }] })
	);
	const p = new GeminiProvider(fakeSecrets());
	const out = await p.complete(REQ, { model: 'gemini-2.5-flash' });

	assert.equal(out, 'GEM');
	assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
	assert.match(calls[0].url, /models\/gemini-2\.5-flash:generateContent$/);
	// Key must travel in the header, never the URL (URLs leak into logs).
	assert.ok(!calls[0].url.includes(KEY), 'API key must not appear in the URL');
	assert.equal(headersOf(calls[0])['x-goog-api-key'], KEY);
	const body = bodyOf(calls[0]);
	assert.ok(Array.isArray(body.contents));
	assert.ok(body.systemInstruction);
});

test('Gemini: HTTP error surfaces status code', async () => {
	installFetch(() => httpError(429, 'rate limited'));
	await assert.rejects(() => new GeminiProvider(fakeSecrets()).complete(REQ), /429/);
});

/* ============================= OpenAI ============================= */

test('OpenAI: chat/completions endpoint, Bearer auth, body + parse', async () => {
	const calls = installFetch(() =>
		jsonOk({ choices: [{ message: { content: 'OAI' } }] })
	);
	const p = createOpenAIProvider(fakeSecrets());
	const out = await p.complete(REQ, { model: 'gpt-5.4-mini' });

	assert.equal(out, 'OAI');
	assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
	assert.equal(headersOf(calls[0]).Authorization, `Bearer ${KEY}`);
	const body = bodyOf(calls[0]);
	assert.equal(body.model, 'gpt-5.4-mini');
	assert.deepEqual(body.messages, [
		{ role: 'system', content: REQ.system },
		{ role: 'user', content: REQ.user },
	]);
});

test('OpenAI: HTTP error surfaces status code (the lost-user case)', async () => {
	installFetch(() => httpError(500, 'internal error'));
	await assert.rejects(() => createOpenAIProvider(fakeSecrets()).complete(REQ), /500/);
});

test('OpenAI: empty content rejects rather than returning ""', async () => {
	installFetch(() => jsonOk({ choices: [{ message: { content: '' } }] }));
	await assert.rejects(() => createOpenAIProvider(fakeSecrets()).complete(REQ), /no text/i);
});

/* ============================= OpenRouter ============================= */

test('OpenRouter: own base URL, Bearer auth, and attribution headers', async () => {
	const calls = installFetch(() =>
		jsonOk({ choices: [{ message: { content: 'OR' } }] })
	);
	const p = createOpenRouterProvider(fakeSecrets());
	const out = await p.complete(REQ, { model: 'anthropic/claude-sonnet-4-6' });

	assert.equal(out, 'OR');
	assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
	const h = headersOf(calls[0]);
	assert.equal(h.Authorization, `Bearer ${KEY}`);
	assert.equal(h['X-Title'], 'Vibe Check');
	assert.ok(h['HTTP-Referer']);
});

/* ============================= Copilot (VS Code LM) ============================= */

test('Copilot: unavailable when no LM models, available when present', async () => {
	const p = new CopilotProvider();
	__test.lmModels = null;
	assert.equal(await p.isAvailable(), false);

	__test.lmModels = [{ family: 'gpt-4o', vendor: 'copilot' }];
	assert.equal(await p.isAvailable(), true);
});

test('Copilot: streams model response text', async () => {
	__test.lmModels = [{ family: 'gpt-4o', vendor: 'copilot' }];
	__test.lmResponseText = 'COPILOT OUTPUT';
	const out = await new CopilotProvider().complete(REQ);
	assert.equal(out, 'COPILOT OUTPUT');
});

test('Copilot: throws a helpful error when no model is available', async () => {
	__test.lmModels = null;
	await assert.rejects(() => new CopilotProvider().complete(REQ), /No VS Code language model|unavailable/i);
});

/* ============================= Antigravity ============================= */

test('Antigravity: uses host globalThis.ai.generateText', async () => {
	const g = globalThis as unknown as Record<string, unknown>;
	g.antigravity = {
		ai: { generateText: async (_o: unknown) => ({ text: 'ANTIGRAV' }) },
	};
	EnvironmentDetector.reset();
	try {
		const p = new AntigravityProvider();
		assert.equal(await p.isAvailable(), true);
		assert.equal(await p.complete(REQ), 'ANTIGRAV');
	} finally {
		delete g.antigravity;
		EnvironmentDetector.reset();
	}
});

test('Antigravity: unavailable outside the Antigravity host', async () => {
	EnvironmentDetector.reset();
	assert.equal(await new AntigravityProvider().isAvailable(), false);
});
