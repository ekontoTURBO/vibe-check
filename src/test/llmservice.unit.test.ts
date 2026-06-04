import test from 'node:test';
import assert from 'node:assert/strict';

import { LLMService } from '../LLMService';
import type { ProviderRegistry } from '../providers/registry';
import { __test } from './stubs/vscode';

interface FakeProvider {
	id: string;
	label: string;
	calls: number;
	complete: (...a: unknown[]) => Promise<string>;
}

function provider(
	id: string,
	behaviour: (callIndex: number) => Promise<string>
): FakeProvider {
	const p: FakeProvider = {
		id,
		label: id.toUpperCase(),
		calls: 0,
		complete: async () => {
			const n = p.calls++;
			return behaviour(n);
		},
	};
	return p;
}

function fakeRegistry(
	providers: FakeProvider[],
	usedFallback: string | null = null
): ProviderRegistry {
	return {
		resolveCandidates: async () => ({ providers, usedFallback, wanted: 'auto' }),
		getModelFor: () => 'model-x',
	} as unknown as ProviderRegistry;
}

const REQ = { system: 's', user: 'u', kind: 'lesson' as const };

test.beforeEach(() => __test.reset());

test('returns primary output when the primary succeeds', async () => {
	const a = provider('a', async () => 'A-OK');
	const b = provider('b', async () => 'B');
	const svc = new LLMService(fakeRegistry([a, b]));
	assert.equal(await svc.complete(REQ), 'A-OK');
	assert.equal(a.calls, 1);
	assert.equal(b.calls, 0, 'secondary must not be called when primary works');
});

test('non-transient failure rolls over to the next provider (no retry)', async () => {
	const a = provider('a', async () => {
		throw new Error('OpenAI 401: invalid api key');
	});
	const b = provider('b', async () => 'RESCUED');
	const svc = new LLMService(fakeRegistry([a, b]));
	assert.equal(await svc.complete(REQ), 'RESCUED');
	assert.equal(a.calls, 1, '401 is not transient — primary tried once');
	assert.equal(b.calls, 1);
	assert.ok(
		__test.warnings.some((w) => /falling back to/i.test(w)),
		'user should be warned about the runtime fallback'
	);
});

test('transient failure is retried once on the same provider before falling back', async () => {
	const a = provider('a', async () => {
		throw new Error('Gemini 503: overloaded');
	});
	const b = provider('b', async () => 'B-WINS');
	const svc = new LLMService(fakeRegistry([a, b]));
	assert.equal(await svc.complete(REQ), 'B-WINS');
	assert.equal(a.calls, 2, '503 is transient — primary retried once (2 calls) before fallback');
	assert.equal(b.calls, 1);
});

test('transient error that recovers on retry needs no fallback', async () => {
	const a = provider('a', async (n) => {
		if (n === 0) {
			throw new Error('429 rate limited');
		}
		return 'RECOVERED';
	});
	const b = provider('b', async () => 'SHOULD-NOT-RUN');
	const svc = new LLMService(fakeRegistry([a, b]));
	assert.equal(await svc.complete(REQ), 'RECOVERED');
	assert.equal(a.calls, 2);
	assert.equal(b.calls, 0);
});

test('empty response is treated as a failure and falls back', async () => {
	const a = provider('a', async () => '   ');
	const b = provider('b', async () => 'NON-EMPTY');
	const svc = new LLMService(fakeRegistry([a, b]));
	assert.equal(await svc.complete(REQ), 'NON-EMPTY');
	assert.equal(b.calls, 1);
});

test('when every provider fails, a combined actionable error is thrown', async () => {
	const a = provider('a', async () => {
		throw new Error('OpenAI 500');
	});
	const b = provider('b', async () => {
		throw new Error('Anthropic 529 overloaded');
	});
	const svc = new LLMService(fakeRegistry([a, b]));
	await assert.rejects(
		() => svc.complete(REQ),
		(err: Error) =>
			/All available providers failed/.test(err.message) &&
			/A:/.test(err.message) &&
			/B:/.test(err.message)
	);
});

test('config-level fallback (wanted provider missing) warns once', async () => {
	const a = provider('a', async () => 'OK');
	const svc = new LLMService(fakeRegistry([a], 'openai'));
	assert.equal(await svc.complete(REQ), 'OK');
	assert.ok(
		__test.warnings.some((w) => /isn't configured/i.test(w)),
		'should warn the user their picked provider was substituted'
	);
});

test('fallback warnings are not spammed across repeated calls', async () => {
	const a = provider('a', async () => {
		throw new Error('401 bad');
	});
	const b = provider('b', async () => 'OK');
	const svc = new LLMService(fakeRegistry([a, b]));
	await svc.complete(REQ);
	const afterFirst = __test.warnings.length;
	// Reset call counters but keep the same service instance (its notified set persists).
	a.calls = 0;
	b.calls = 0;
	await svc.complete(REQ);
	assert.equal(__test.warnings.length, afterFirst, 'same fallback should warn only once per session');
});
