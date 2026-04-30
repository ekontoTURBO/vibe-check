#!/usr/bin/env node
/**
 * Smoke test for the lesson-question JSON parser.
 *
 * Reproduces the helpers in src/TeacherProvider.ts as plain ESM so we can
 * exercise them without dragging in `vscode` and the rest of the extension
 * runtime. If you change the parser, change both.
 *
 * Run with:  node scripts/smoke-test-json-parser.mjs
 */

/* ============================================================
   PARSER UNDER TEST — inlined from src/TeacherProvider.ts.
   Keep these in sync with the production code.
   ============================================================ */

function stripInvisibles(s) {
	return s.replace(/^[﻿​‌‍⁠]+/, '');
}

function stripFences(s) {
	return s
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/i, '')
		.trim();
}

function looksLikeRefusal(text) {
	const lower = text.toLowerCase();
	const tells = [
		'sorry',
		'cannot generate',
		'too minimal',
		'too small',
		'not enough',
		'insufficient',
		'please provide',
		'unable to',
	];
	return tells.some((t) => lower.includes(t)) && lower.length < 600;
}

function extractAllJsonObjects(s) {
	const out = [];
	let i = 0;
	while (i < s.length) {
		if (s[i] !== '{') {
			i++;
			continue;
		}
		let depth = 0;
		let inString = null;
		let escape = false;
		let end = -1;
		for (let j = i; j < s.length; j++) {
			const c = s[j];
			if (escape) {
				escape = false;
				continue;
			}
			if (c === '\\' && inString) {
				escape = true;
				continue;
			}
			if (inString) {
				if (c === inString) {
					inString = null;
				}
				continue;
			}
			if (c === '"' || c === "'") {
				inString = c;
				continue;
			}
			if (c === '{') {
				depth++;
			} else if (c === '}') {
				depth--;
				if (depth === 0) {
					end = j;
					break;
				}
			}
		}
		if (end === -1) {
			i++;
			continue;
		}
		out.push(s.slice(i, end + 1));
		i = end + 1;
	}
	return out;
}

function convertSingleQuotedStrings(s) {
	let out = '';
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === '"') {
			out += c;
			i++;
			while (i < s.length) {
				const cc = s[i];
				out += cc;
				i++;
				if (cc === '\\' && i < s.length) {
					out += s[i];
					i++;
					continue;
				}
				if (cc === '"') {
					break;
				}
			}
			continue;
		}
		if (c === "'") {
			out += '"';
			i++;
			while (i < s.length) {
				const cc = s[i];
				if (cc === '\\' && i + 1 < s.length) {
					out += cc + s[i + 1];
					i += 2;
					continue;
				}
				if (cc === '"') {
					out += '\\"';
					i++;
					continue;
				}
				if (cc === "'") {
					out += '"';
					i++;
					break;
				}
				out += cc;
				i++;
			}
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

function repairJson(s) {
	let out = s;
	out = out
		.replace(/[“”„‟]/g, '"')
		.replace(/[‘’‚‛]/g, "'");
	out = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
	out = convertSingleQuotedStrings(out);
	out = out.replace(/,(\s*[}\]])/g, '$1');
	out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
	return out;
}

function tryParseAndRepair(candidate) {
	try {
		return { ok: true, value: JSON.parse(candidate) };
	} catch (err) {
		const repaired = repairJson(candidate);
		if (repaired !== candidate) {
			try {
				return { ok: true, value: JSON.parse(repaired) };
			} catch {}
		}
		return { ok: false, err };
	}
}

function parseJsonObject(raw, validator = () => true) {
	const cleaned = stripFences(stripInvisibles(raw)).trim();
	if (looksLikeRefusal(cleaned) && !cleaned.includes('{')) {
		throw new Error('refusal');
	}
	const candidates = extractAllJsonObjects(cleaned);
	let firstParseable = null;
	let lastErr = null;
	for (const c of candidates) {
		const r = tryParseAndRepair(c);
		if (!r.ok) {
			lastErr = r.err;
			continue;
		}
		if (!firstParseable) firstParseable = r.value;
		if (validator(r.value)) return r.value;
	}
	if (firstParseable) {
		throw new Error(`SHAPE_MISMATCH: ${JSON.stringify(firstParseable).slice(0, 80)}`);
	}
	if (lastErr) throw new Error(`PARSE_FAILED: ${lastErr.message}`);
	throw new Error('NO_JSON_FOUND');
}

/* ============================================================
   FIXTURES — modes Gemini and other LLMs are known to produce.
   Each `expected` is the JSON we expect after parsing succeeds.
   ============================================================ */

const FIXTURES = [
	{
		name: 'plain valid JSON (control)',
		input: '{"questions":[{"type":"mc","correctIndex":0}]}',
		expected: { questions: [{ type: 'mc', correctIndex: 0 }] },
	},
	{
		name: 'JSON wrapped in ```json fences',
		input: '```json\n{"title":"Auth flow","lessons":[{"title":"L1"}]}\n```',
		expected: { title: 'Auth flow', lessons: [{ title: 'L1' }] },
	},
	{
		name: 'JSON wrapped in plain ``` fences',
		input: '```\n{"k":1}\n```',
		expected: { k: 1 },
	},
	{
		name: 'JSON with prose prefix (Gemini-style)',
		input: 'Sure! Here is the JSON you requested:\n\n{"answer":42}',
		expected: { answer: 42 },
	},
	{
		name: 'JSON with prose prefix and fences',
		input: 'Of course. Here is the lesson:\n```json\n{"x":"y"}\n```',
		expected: { x: 'y' },
	},
	{
		name: 'BOM prefix (U+FEFF)',
		input: '﻿{"x":1}',
		expected: { x: 1 },
	},
	{
		name: 'Zero-width space prefix (U+200B)',
		input: '​{"x":1}',
		expected: { x: 1 },
	},
	{
		name: 'Smart double quotes for keys/values',
		input: '{“questions”:[{“type”:“mc”,“correctIndex”:0}]}',
		expected: { questions: [{ type: 'mc', correctIndex: 0 }] },
	},
	{
		name: 'Single-quoted strings (the actual Gemini failure mode)',
		input: "{'questions':[{'type':'mc','prompt':'What does it do?','correctIndex':0}]}",
		expected: { questions: [{ type: 'mc', prompt: 'What does it do?', correctIndex: 0 }] },
	},
	{
		name: 'Single-quoted strings containing apostrophes inside double quotes',
		input: '{"a": "don\'t do this", \'b\': \'works either way\'}',
		expected: { a: "don't do this", b: 'works either way' },
	},
	{
		name: 'Unquoted property names',
		input: '{questions: [{type: "mc", correctIndex: 0}]}',
		expected: { questions: [{ type: 'mc', correctIndex: 0 }] },
	},
	{
		name: 'Trailing commas',
		input: '{"questions":[1,2,3,],"meta":{"v":1,},}',
		expected: { questions: [1, 2, 3], meta: { v: 1 } },
	},
	{
		name: '// line comments interspersed',
		input: '{\n  "x": 1, // this is the count\n  "y": 2 // and this\n}',
		expected: { x: 1, y: 2 },
	},
	{
		name: '/* block comments */',
		input: '{\n  /* preamble */ "x": 1,\n  "y": 2 /* trailing */\n}',
		expected: { x: 1, y: 2 },
	},
	{
		name: 'Combined nightmare: BOM + prose + fences + smart quotes + single quotes + trailing comma + comment',
		input:
			'﻿Of course! Here is the JSON you asked for:\n```json\n{\n  // top-level comment\n  “questions”: [\n    {\'type\': \'mc\', \'correctIndex\': 0,},\n  ],\n}\n```',
		expected: { questions: [{ type: 'mc', correctIndex: 0 }] },
	},
	/* ============================================================
	   ROOT-CAUSE candidates for the friend's specific bug.
	   The error was:
	     "Expected property name or '}' in JSON at position 2 (line 1 column 3)"
	   on a HUGE repo with Gemini. Below are the most plausible inputs
	   that would produce that exact error.
	   ============================================================ */
	{
		name: 'ROOT-CAUSE: }} inside a single-quoted string (scanner truncates)',
		input: "{'questions': [{'type': 'mc', 'prompt': 'What does `() => { return 1; }` return?', 'correctIndex': 0}]}",
		expected: {
			questions: [
				{
					type: 'mc',
					prompt: 'What does `() => { return 1; }` return?',
					correctIndex: 0,
				},
			],
		},
	},
	{
		name: 'ROOT-CAUSE: } inside single-quoted string with surrounding code',
		input: "{'questions': [{'prompt': 'is `if (x) { return; }` a void return?'}]}",
		expected: {
			questions: [{ prompt: 'is `if (x) { return; }` a void return?' }],
		},
	},
	{
		name: 'ROOT-CAUSE: prose prefix WITH apostrophe before single-quoted JSON',
		input: "Here's the JSON: {'k': 'v'}",
		expected: { k: 'v' },
	},
	{
		name: 'EMPTY-STRING fixture (Gemini returned literally empty content)',
		input: '',
		expected: '__SHOULD_THROW__',
	},
	{
		name: 'WHITESPACE-ONLY fixture (Gemini returned just blanks)',
		input: '   \n\n  ',
		expected: '__SHOULD_THROW__',
	},
	{
		name: 'PROSE-ONLY fixture (no JSON at all — refusal)',
		input: 'Sorry, I cannot generate questions for this minimal context.',
		expected: '__SHOULD_THROW__',
	},
	{
		name: 'TRUNCATED-MID-STRING (output token limit hit)',
		input: '{"questions":[{"type":"mc","prompt":"This is a long prompt that gets cut',
		expected: '__SHOULD_THROW__',
	},
	/* ============================================================
	   BULLETPROOF: shape-aware extraction — pick the right candidate
	   even when noise objects come first.
	   ============================================================ */
	{
		name: 'BULLETPROOF: Gemini thinking with code snippets, then real answer',
		input:
			'I will analyze the code. Looking at `if (state.count > 0) { return true; }` ' +
			'shows the early-return pattern. Now let me also check `for (const x of arr) { use(x); }` ' +
			'— that\'s a clean iteration. {"questions":[{"prompt":"What does the early-return do?","explanation":"e"}]}',
		validator: (v) => Array.isArray(v?.questions),
		expected: { questions: [{ prompt: 'What does the early-return do?', explanation: 'e' }] },
	},
	{
		name: 'BULLETPROOF: Anthropic thinking-then-answer (text block leak simulation)',
		input:
			'<thinking>The function `(a) => { return a*2; }` doubles its arg. The map `{key: 1, val: 2}` is a config.</thinking>\n' +
			'{"questions": [{"prompt": "What does the doubler return for 5?", "explanation": "10"}]}',
		validator: (v) => Array.isArray(v?.questions),
		expected: { questions: [{ prompt: 'What does the doubler return for 5?', explanation: '10' }] },
	},
	{
		name: 'BULLETPROOF: o1-style reasoning prefix with multiple inline {} before real answer',
		input:
			'Reasoning: I considered {opt: "a"} and {opt: "b"} before settling. ' +
			'{"questions": [{"prompt": "Q?", "explanation": "A"}]}',
		validator: (v) => Array.isArray(v?.questions),
		expected: { questions: [{ prompt: 'Q?', explanation: 'A' }] },
	},
	{
		name: 'BULLETPROOF: } inside single-quoted string (the actual scanner bug)',
		input: "{'questions': [{'prompt': 'Does `if (x) { return; }` return undefined?', 'explanation': 'yes'}]}",
		validator: (v) => Array.isArray(v?.questions),
		expected: {
			questions: [
				{
					prompt: 'Does `if (x) { return; }` return undefined?',
					explanation: 'yes',
				},
			],
		},
	},
	{
		name: 'BULLETPROOF: skeleton shape — pick { lessons: [...] } not { thinking_tag: ... }',
		input:
			'{ "internal_thought": "let me plan this" }\n' +
			'{ "title": "Auth", "lessons": [{ "title": "L1", "objective": "O1" }] }',
		validator: (v) => Array.isArray(v?.lessons) && v.lessons.length > 0,
		expected: { title: 'Auth', lessons: [{ title: 'L1', objective: 'O1' }] },
	},
	{
		name: 'BULLETPROOF: shape mismatch when no candidate has the right keys',
		input: '{ "noise": 1 } { "also_noise": 2 }',
		validator: (v) => Array.isArray(v?.questions),
		expected: '__SHOULD_THROW__',
	},
];

/* ============================================================
   RUN — one row per fixture, pass/fail with diagnostic on fail.
   ============================================================ */

let passed = 0;
let failed = 0;

console.log('\n┌─────────────────────────────────────────────────────────────────────────┐');
console.log('│  Vibe Check — JSON parser smoke test                                    │');
console.log('└─────────────────────────────────────────────────────────────────────────┘\n');

for (const { name, input, expected, validator } of FIXTURES) {
	let result;
	let error;
	try {
		result = parseJsonObject(input, validator);
	} catch (e) {
		error = e;
	}
	const shouldThrow = expected === '__SHOULD_THROW__';
	let ok;
	if (shouldThrow) {
		ok = !!error;
	} else {
		ok = !error && JSON.stringify(result) === JSON.stringify(expected);
	}
	if (ok) {
		const note = shouldThrow ? ` \x1b[2m(threw: ${error?.message?.slice(0, 60)})\x1b[0m` : '';
		console.log(`  \x1b[32m✓ PASS\x1b[0m  ${name}${note}`);
		passed++;
	} else {
		console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${name}`);
		console.log(`           input:    ${JSON.stringify(input).slice(0, 100)}`);
		console.log(`           expected: ${JSON.stringify(expected)}`);
		console.log(`           got:      ${error ? error.message : JSON.stringify(result)}`);
		failed++;
	}
}

console.log(`\n  Result: ${passed}/${FIXTURES.length} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
