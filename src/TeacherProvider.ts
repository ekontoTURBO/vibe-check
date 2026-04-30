import { LLMService } from './LLMService';
import {
	CodeOrderQuestion,
	FillBlankQuestion,
	LineRange,
	Module,
	ModuleLesson,
	MultipleChoiceQuestion,
	Question,
	Topic,
	Track,
} from './types';

const TRACK_GUIDE: Record<Track, string> = {
	beginner:
		'BEGINNER. Recognition and recall: what does this token/keyword/setting mean? Match a definition. Plain language, no deep logic.',
	intermediate:
		'INTERMEDIATE. Applied logic: trace what code does with input X, predict output, identify correct sequence, spot a bug from a list.',
	expert:
		'EXPERT. Architecture and trade-offs: edge cases, security, performance, design alternatives, what breaks under load.',
};

const TOPIC_GUIDE: Record<Topic, string> = {
	code: 'The actual code provided — what it does, control flow, edge cases.',
	infrastructure:
		'Build system, configuration, tsconfig flags, eslint rules, CI, Docker, package manifests.',
	tools: 'Libraries, frameworks, and tooling — what each is for, common pitfalls, scripts.',
	architecture: 'Module boundaries, where responsibilities live, how layers connect.',
	security: 'Input validation, injection vectors, secret handling, auth flows, dependency risks.',
};

/** Hard rules every lesson prompt must enforce — prevents the "what color is used" trivia drift. */
const QUALITY_RULES = `QUALITY RULES (HARD CONSTRAINTS — violating any of these makes a question invalid):

DO NOT ASK ABOUT:
- Variable names, function names, parameter names ("what is the variable called")
- String literals, log messages, comment text, color values, error message wording
- Casing, indentation, whitespace, line counts, character counts
- Magic numbers as values ("what number is on line 5") — only ask why a number is what it is
- The exact contents of imports, file paths, or filenames
- Trivia about syntax that any IDE highlights ("what keyword starts a function")

DO ASK ABOUT:
- BEHAVIOR: what a block does, what it returns, what side effects it produces
- CONTROL FLOW: which branch runs when X, what order operations execute, what triggers what
- DATA: how data shape transforms through the code, what gets stored vs returned
- EDGE CASES: what happens with empty input, null, errors, concurrent calls, large inputs
- PURPOSE: why a block exists, what problem it solves, what would break without it
- DEPENDENCIES: what this code needs to work, what depends on it, coupling concerns

QUESTIONS MUST REFER TO MEANINGFUL CODE BLOCKS, NOT INDIVIDUAL TOKENS.
For multiple-choice, the prompt should reference a section ("the function that does X", "the block on lines 8-15", "the validation step") not a single line or identifier.

If the provided context is too small or trivial to support a non-trivial question on this lesson's objective, return FEWER questions rather than padding with trivia. Quality > quantity.`;

interface ParsedSkeletonLesson {
	title: string;
	objective: string;
	topic?: Topic;
}

interface ParsedSkeleton {
	title: string;
	lessons: ParsedSkeletonLesson[];
}

interface ParsedMC {
	type: 'multiple-choice';
	prompt: string;
	options: string[];
	correctIndex: number;
	explanation: string;
	lineRange?: LineRange;
}

interface ParsedCO {
	type: 'code-order';
	prompt: string;
	correctSequence: string[];
	explanation: string;
	lineRange?: LineRange;
}

interface ParsedFB {
	type: 'fill-blank';
	prompt: string;
	codeBefore: string;
	codeAfter: string;
	options: string[];
	correctIndex: number;
	explanation: string;
	lineRange?: LineRange;
}

type ParsedQuestion = ParsedMC | ParsedCO | ParsedFB;

export interface ContextSize {
	lessons: number;
	questionsPerLesson: number;
}

/** Decide module size from context length. Tiny dumps shouldn't be padded with trivia. */
export function sizeForContext(contextChars: number): ContextSize {
	if (contextChars < 800) {
		return { lessons: 2, questionsPerLesson: 3 };
	}
	if (contextChars < 2500) {
		return { lessons: 3, questionsPerLesson: 4 };
	}
	if (contextChars < 6000) {
		return { lessons: 4, questionsPerLesson: 5 };
	}
	return { lessons: 5, questionsPerLesson: 5 };
}

/** Pick lesson topics for an auto-fired (mixed) module, taking N from the priority order. */
export function pickMixedTopics(lessonCount: number): Topic[] {
	const priority: Topic[] = ['code', 'security', 'architecture', 'tools', 'code'];
	return priority.slice(0, Math.max(1, lessonCount));
}

export interface ModuleSkeletonOptions {
	topic: Topic;
	track: Track;
	context: string;
	contextLabel: string;
	sourceFile?: string;
	baseLine?: number;
	/** When provided, generates a mixed-topic skeleton instead of a single-topic one. */
	topicMix?: Topic[];
}

export class TeacherProvider {
	constructor(private llm: LLMService) {}

	async generateModuleSkeleton(opts: ModuleSkeletonOptions): Promise<Module> {
		const size = sizeForContext(opts.context.length);
		const isMixed = !!opts.topicMix && opts.topicMix.length > 1;
		const lessonTopics = isMixed
			? (opts.topicMix as Topic[]).slice(0, size.lessons)
			: Array(size.lessons).fill(opts.topic);

		const system = isMixed
			? this.buildMixedSkeletonSystemPrompt(lessonTopics, opts.track, size.lessons)
			: this.buildSkeletonSystemPrompt(opts.topic, opts.track, size.lessons);
		const user = this.buildContextPrompt(opts.contextLabel, opts.context);
		const raw = await this.llm.complete({ system, user, maxTokens: 800, expectJson: true });
		const parsed = this.parseSkeleton(raw, size.lessons);

		const moduleId = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const lessons: ModuleLesson[] = parsed.lessons.map((l, i) => ({
			id: `${moduleId}-l${i}`,
			index: i,
			title: l.title,
			objective: l.objective,
			state: i === 0 ? 'available' : 'locked',
			topic: isMixed ? lessonTopics[i] ?? opts.topic : undefined,
		}));

		return {
			id: moduleId,
			title: parsed.title || `${capitalize(opts.topic)} (${opts.track})`,
			topic: opts.topic,
			track: opts.track,
			lessons,
			context: opts.context,
			contextLabel: opts.contextLabel,
			sourceFile: opts.sourceFile,
			baseLine: opts.baseLine ?? 0,
			createdAt: Date.now(),
			topicMix: isMixed ? lessonTopics : undefined,
			questionsPerLesson: size.questionsPerLesson,
		};
	}

	async explainWrongAnswer(
		question: Question,
		userAnswerText: string,
		correctAnswerText: string
	): Promise<string> {
		const system = `You are a kind, direct tutor. The student got a quiz question wrong. In 1-3 short sentences, explain SPECIFICALLY why their answer is incorrect — point at the misconception, not just the right answer. Refer to their actual choice. Don't restate the question. No preamble like "Great try!" — just the explanation.`;

		const user = `Question: ${question.prompt}

Their answer: ${userAnswerText}

Correct answer: ${correctAnswerText}

Reference (canonical) explanation: ${question.explanation}

Now write the personalized explanation of WHY their answer is wrong.`;

		const reply = await this.llm.complete({ system, user, maxTokens: 250 });
		return reply.trim();
	}

	async generateLessonQuestions(module: Module, lesson: ModuleLesson): Promise<Question[]> {
		const questionsPerLesson = module.questionsPerLesson ?? 5;
		const lessonTopic = lesson.topic ?? module.topic;
		const minQuestions = Math.min(2, questionsPerLesson);

		const attempt = async (strict: boolean): Promise<ParsedQuestion[]> => {
			const system = this.buildLessonSystemPrompt(
				module,
				lesson,
				lessonTopic,
				questionsPerLesson,
				strict
			);
			const user = this.buildContextPrompt(module.contextLabel, module.context);
			const maxTokens = Math.min(2000, 350 + questionsPerLesson * 280);
			const raw = await this.llm.complete({ system, user, maxTokens, expectJson: true });
			return this.parseQuestions(raw);
		};

		let parsed = await attempt(false);
		if (parsed.length < minQuestions) {
			// One automatic retry with a stricter "you MUST return at least N" instruction.
			console.warn(
				`[VibeCheck] Lesson returned ${parsed.length} questions, minimum is ${minQuestions} — retrying once`
			);
			parsed = await attempt(true);
			if (parsed.length < minQuestions) {
				throw new Error(
					`Model only returned ${parsed.length} question${parsed.length === 1 ? '' : 's'} after a retry. Try regenerating, or open a richer file with more behaviour to quiz on.`
				);
			}
		}

		return parsed.map((p, i) =>
			this.toQuestion(p, module, lesson, lessonTopic, module.baseLine, i)
		);
	}

	private buildSkeletonSystemPrompt(topic: Topic, track: Track, lessonCount: number): string {
		return `You are designing a Duolingo-style MODULE for the "Vibe Check" extension. A module contains EXACTLY ${lessonCount} sequential lessons that progress from surface-level to deep understanding. The learner unlocks lessons one at a time.

MODULE SPEC
- Topic: ${topic} — ${TOPIC_GUIDE[topic]}
- Track (difficulty): ${track} — ${TRACK_GUIDE[track]}
- Lesson count: ${lessonCount} (chosen because the context is ${lessonCount <= 2 ? 'small' : lessonCount <= 3 ? 'modest' : lessonCount <= 4 ? 'substantial' : 'large'} — don't pad).

RETURN ONLY JSON (no fences, no prose):
{
  "title": "Module title (3-6 words capturing the core theme)",
  "lessons": [
    { "title": "Lesson 1 title (2-4 words)", "objective": "1 sentence describing what the learner will master in this lesson" }
    ${lessonCount > 1 ? ',\n    { "title": "Lesson 2 title", "objective": "..." }' : ''}${lessonCount > 2 ? ',\n    { "title": "Lesson 3 title", "objective": "..." }' : ''}${lessonCount > 3 ? ',\n    { "title": "Lesson 4 title", "objective": "..." }' : ''}${lessonCount > 4 ? ',\n    { "title": "Lesson 5 title", "objective": "..." }' : ''}
  ]
}

RULES
- Lesson 1 = simplest: identify, recognize, name behavior. Last lesson = synthesis or hardest case.
- Each lesson covers a DISTINCT aspect of the context. No overlap.
- Match difficulty to the track. Beginner module = no expert-level lessons even at the last lesson.
- Lesson titles must be specific (e.g. "Async/await flow" not "Lesson 1").
- Lesson objectives focus on BEHAVIOR / CONTROL FLOW / EDGE CASES — not on naming, comments, or syntax trivia.`;
	}

	private buildMixedSkeletonSystemPrompt(
		topics: Topic[],
		track: Track,
		lessonCount: number
	): string {
		const topicLines = topics
			.map((t, i) => `  Lesson ${i + 1} angle: ${t} — ${TOPIC_GUIDE[t]}`)
			.join('\n');
		return `You are designing a Duolingo-style MIXED MODULE for the "Vibe Check" extension. The same chunk of code is examined from MULTIPLE angles, one angle per lesson. ${lessonCount} lessons total, each unlocked sequentially.

MODULE SPEC
- Mixed module: each lesson tackles a DIFFERENT angle on the SAME code.
- Track (difficulty): ${track} — ${TRACK_GUIDE[track]}

LESSON ANGLES (in order — DO NOT CHANGE THE ORDER):
${topicLines}

RETURN ONLY JSON (no fences, no prose):
{
  "title": "Module title (3-6 words; reflect the code's purpose, not the angles)",
  "lessons": [
    { "title": "Lesson title (2-4 words, reflects this lesson's angle)", "objective": "1 sentence: what learner masters about THIS angle of the code" }
    // ${lessonCount} entries total, in the angle order above
  ]
}

RULES
- Each lesson examines the SAME code through its assigned angle. Don't drift to a different topic.
- Objective must reference the angle (e.g. for security: "Identify the unchecked input path"; for architecture: "Trace which subsystem owns this logic").
- If a given angle has nothing meaningful to ask about this code, write an objective that says so honestly — the question generator will produce fewer questions instead of inventing trivia.
- Match difficulty to the track.`;
	}

	private buildLessonSystemPrompt(
		module: Module,
		lesson: ModuleLesson,
		lessonTopic: Topic,
		questionsPerLesson: number,
		strict = false
	): string {
		const minQ = Math.min(2, questionsPerLesson);
		const headerCountLine = strict
			? `You MUST return BETWEEN ${minQ} AND ${questionsPerLesson} questions. Returning fewer than ${minQ} is invalid output. A previous attempt failed for this exact reason — do not return only one question.`
			: `Return up to ${questionsPerLesson} questions, minimum ${minQ}.`;
		return `You are generating closed questions for ONE specific lesson in a Duolingo-style module. ${headerCountLine}

MODULE: "${module.title}"
THIS LESSON's TOPIC ANGLE: ${lessonTopic} — ${TOPIC_GUIDE[lessonTopic]}
TRACK: ${module.track} — ${TRACK_GUIDE[module.track]}

THIS LESSON (lesson ${lesson.index + 1})
- Title: "${lesson.title}"
- Objective: ${lesson.objective}

Generate between ${minQ} and ${questionsPerLesson} closed questions matching this lesson's objective and the track's difficulty. If the context truly does not support the maximum, return fewer — but NEVER fewer than ${minQ}. Better to have 3 sharp questions than 5 with trivia, but never fewer than ${minQ} or the lesson is unusable.

NEVER REFUSE. Never return a sentence saying the context is too small. Even minimal context (a single function, a tree of folder names, a config file) supports at least 2 questions about what IS visible — about file roles, about which directory owns which concern, about what a config flag does. If you genuinely cannot find 2 things to ask, ask about the most prominent visible elements (file purpose, dependency role, directory responsibility). The response MUST be a JSON object with a "questions" array — no prose, no apology, no markdown fences.

QUESTION TYPES (mix freely — variety is good, but only when it fits):

1. multiple-choice — exactly 4 distinct options, exactly one correct.
   The prompt MUST be about a meaningful behavior, control flow, or design choice — NOT about a single token, name, or value.
   The lineRange is REQUIRED for multiple-choice and must span at least 3 lines (or the entire snippet if shorter). It marks the BLOCK the question is about.
   Distractors must be plausible misreadings of the same code. Never use throwaway options like "none of the above".
   {
     "type": "multiple-choice",
     "prompt": "What does the block on lines X-Y do?" (or similar — refer to the section as a whole),
     "options": ["a","b","c","d"],
     "correctIndex": 0,
     "explanation": "1-3 sentences justifying the correct answer by referring to specific behavior",
     "lineRange": { "start": number, "end": number }   // 1-indexed within source context, REQUIRED for MC
   }

2. code-order — learner reorders shuffled lines into the correct sequence.
   Use ONLY when order is meaningful (control flow, async chain, lifecycle, dependency setup). Do NOT use for arbitrary line lists.
   3-7 lines total. Lines MUST be unique strings.
   {
     "type": "code-order",
     "prompt": "Reorder these lines to ...",
     "correctSequence": ["line1","line2","line3"],
     "explanation": "1-3 sentences",
     "lineRange": { "start": number, "end": number }   // OPTIONAL
   }

3. fill-blank — learner picks the missing token/expression that completes a code snippet.
   Show 2-5 lines of code BEFORE the blank and 0-3 lines AFTER. The blank should be a meaningful expression, condition, call, or argument — NOT a variable name or string literal.
   Options must be 4 plausible candidates that all parse correctly in context; only one preserves the intended behavior.
   {
     "type": "fill-blank",
     "prompt": "What expression completes the gap so this validates input correctly?" (or similar),
     "codeBefore": "if (typeof user === 'object' && user !== null) {\\n  if (",
     "codeAfter": ") {\\n    return user.id;\\n  }\\n}",
     "options": ["user.id","user.id != null","'id' in user","Object.hasOwn(user, 'id')"],
     "correctIndex": 1,
     "explanation": "...",
     "lineRange": { "start": number, "end": number }   // OPTIONAL
   }

OUTPUT — raw JSON, no fences:
{ "questions": [ ... up to ${questionsPerLesson} items ... ] }

${QUALITY_RULES}

RULES
- All questions answerable from the provided context. No outside knowledge required.
- Stay laser-focused on this lesson's objective and angle. Do not drift to a different aspect of the code.
- Match difficulty to the track precisely.
- For multiple-choice, ALWAYS provide a lineRange spanning ≥3 lines (or whole context if shorter).`;
	}

	private buildContextPrompt(label: string, context: string): string {
		return `CONTEXT (${label}):

"""
${context}
"""

CONTEXT GUIDANCE:
- Skip imports, license headers, and pure constants when picking what to quiz on. Find the behavior-rich section.
- If the context contains a well-defined function/class/block, prefer questions about THAT block as a whole.
- If the context is mostly boilerplate or trivial, return fewer questions — do not invent trivia to pad.

Generate now.`;
	}

	private parseSkeleton(raw: string, expectedLessons: number): ParsedSkeleton {
		// Shape: { "title": "...", "lessons": [{title, objective}, ...] }
		const obj = parseJsonObject(raw, (v) => {
			if (!v || typeof v !== 'object') {
				return false;
			}
			const r = v as Record<string, unknown>;
			return Array.isArray(r.lessons) && r.lessons.length > 0;
		});
		const r = obj as Record<string, unknown>;
		const title = typeof r.title === 'string' ? r.title : '';
		const arr = Array.isArray(r.lessons) ? r.lessons : [];
		const lessons: ParsedSkeletonLesson[] = [];
		for (const item of arr) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const li = item as Record<string, unknown>;
			if (typeof li.title === 'string' && typeof li.objective === 'string') {
				lessons.push({ title: li.title, objective: li.objective });
			}
		}
		const minLessons = Math.max(2, Math.min(expectedLessons, 2));
		if (lessons.length < minLessons) {
			throw new Error(`Module skeleton had ${lessons.length} valid lessons, need at least ${minLessons}`);
		}
		while (lessons.length < expectedLessons) {
			lessons.push({
				title: `Lesson ${lessons.length + 1}`,
				objective: 'Further practice on this topic',
			});
		}
		return { title, lessons: lessons.slice(0, expectedLessons) };
	}

	private parseQuestions(raw: string): ParsedQuestion[] {
		// Shape: { "questions": [{prompt, explanation, ...}, ...] }
		// The validator filters out objects that DON'T have a `questions`
		// array — so thinking/reasoning content with code snippets that
		// happen to contain balanced `{...}` is correctly skipped.
		const obj = parseJsonObject(raw, (v) => {
			if (!v || typeof v !== 'object') {
				return false;
			}
			const r = v as Record<string, unknown>;
			if (Array.isArray(r.questions) && r.questions.length > 0) {
				return true;
			}
			// Also accept a bare array of question-shaped objects (some
			// providers lift the wrapper).
			if (
				Array.isArray(v) &&
				v.length > 0 &&
				typeof (v[0] as Record<string, unknown>)?.prompt === 'string'
			) {
				return true;
			}
			return false;
		});
		const r = obj as Record<string, unknown>;
		const arr = Array.isArray(r.questions) ? r.questions : Array.isArray(obj) ? (obj as unknown[]) : [];
		const out: ParsedQuestion[] = [];
		for (const item of arr) {
			const q = this.validateQuestion(item);
			if (q) {
				out.push(q);
			}
		}
		if (out.length === 0) {
			throw new Error('Lesson contained no valid questions');
		}
		return out;
	}

	private validateQuestion(item: unknown): ParsedQuestion | null {
		if (!item || typeof item !== 'object') {
			return null;
		}
		const r = item as Record<string, unknown>;
		if (typeof r.prompt !== 'string' || typeof r.explanation !== 'string') {
			return null;
		}
		const lineRange = this.parseLineRange(r.lineRange);

		if (r.type === 'multiple-choice') {
			if (!Array.isArray(r.options) || r.options.length < 2) {
				return null;
			}
			const options = r.options.filter((o): o is string => typeof o === 'string');
			if (options.length !== r.options.length) {
				return null;
			}
			const ci = r.correctIndex;
			if (typeof ci !== 'number' || ci < 0 || ci >= options.length) {
				return null;
			}
			return {
				type: 'multiple-choice',
				prompt: r.prompt,
				options,
				correctIndex: Math.floor(ci),
				explanation: r.explanation,
				lineRange,
			};
		}

		if (r.type === 'code-order') {
			if (!Array.isArray(r.correctSequence) || r.correctSequence.length < 2) {
				return null;
			}
			const seq = r.correctSequence.filter((s): s is string => typeof s === 'string');
			if (seq.length !== r.correctSequence.length) {
				return null;
			}
			if (new Set(seq).size !== seq.length) {
				return null;
			}
			return {
				type: 'code-order',
				prompt: r.prompt,
				correctSequence: seq,
				explanation: r.explanation,
				lineRange,
			};
		}

		if (r.type === 'fill-blank') {
			if (typeof r.codeBefore !== 'string' || typeof r.codeAfter !== 'string') {
				return null;
			}
			if (!Array.isArray(r.options) || r.options.length < 2) {
				return null;
			}
			const options = r.options.filter((o): o is string => typeof o === 'string');
			if (options.length !== r.options.length) {
				return null;
			}
			if (new Set(options).size !== options.length) {
				return null;
			}
			const ci = r.correctIndex;
			if (typeof ci !== 'number' || ci < 0 || ci >= options.length) {
				return null;
			}
			// Reject empty or trivial gaps.
			const correct = options[Math.floor(ci)];
			if (!correct.trim()) {
				return null;
			}
			return {
				type: 'fill-blank',
				prompt: r.prompt,
				codeBefore: r.codeBefore,
				codeAfter: r.codeAfter,
				options,
				correctIndex: Math.floor(ci),
				explanation: r.explanation,
				lineRange,
			};
		}

		return null;
	}

	private parseLineRange(raw: unknown): LineRange | undefined {
		if (!raw || typeof raw !== 'object') {
			return undefined;
		}
		const r = raw as Record<string, unknown>;
		if (typeof r.start !== 'number' || typeof r.end !== 'number') {
			return undefined;
		}
		return { start: r.start, end: r.end };
	}

	private toQuestion(
		p: ParsedQuestion,
		module: Module,
		lesson: ModuleLesson,
		lessonTopic: Topic,
		baseLine: number,
		index: number
	): Question {
		const id = `q-${lesson.id}-${index}-${Math.random().toString(36).slice(2, 6)}`;

		// Slice the inline code snippet from module.context BEFORE adjusting line range to editor coords.
		const codeSnippet = sliceContextLines(module.context, p.lineRange);

		const lineRange = p.lineRange
			? {
					start: baseLine + Math.max(0, p.lineRange.start - 1),
					end: baseLine + Math.max(0, p.lineRange.end - 1),
			  }
			: undefined;

		const base = {
			id,
			prompt: p.prompt,
			explanation: p.explanation,
			track: module.track,
			topic: lessonTopic,
			moduleId: module.id,
			lessonId: lesson.id,
			sourceFile: module.sourceFile,
			lineRange,
			codeSnippet,
			createdAt: Date.now(),
		};

		if (p.type === 'multiple-choice') {
			// Shuffle to defeat the model's bias toward correctIndex: 0.
			const shuffled = shuffleOptions(p.options, p.correctIndex, id);
			const q: MultipleChoiceQuestion = {
				...base,
				type: 'multiple-choice',
				options: shuffled.options,
				correctIndex: shuffled.correctIndex,
			};
			return q;
		}
		if (p.type === 'code-order') {
			const q: CodeOrderQuestion = {
				...base,
				type: 'code-order',
				correctSequence: p.correctSequence,
			};
			return q;
		}
		const shuffled = shuffleOptions(p.options, p.correctIndex, id);
		const q: FillBlankQuestion = {
			...base,
			type: 'fill-blank',
			codeBefore: p.codeBefore,
			codeAfter: p.codeAfter,
			options: shuffled.options,
			correctIndex: shuffled.correctIndex,
		};
		return q;
	}
}

/** Seeded Fisher-Yates shuffle of options that tracks where the correct answer landed. */
function shuffleOptions(
	options: string[],
	correctIndex: number,
	seed: string
): { options: string[]; correctIndex: number } {
	if (options.length <= 1) {
		return { options: [...options], correctIndex };
	}
	const correctAnswer = options[correctIndex];
	const indices = options.map((_, i) => i);
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h = ((h ^ seed.charCodeAt(i)) >>> 0) * 16777619;
		h = h >>> 0;
	}
	for (let i = indices.length - 1; i > 0; i--) {
		h = ((h * 1664525) >>> 0) + 1013904223;
		h = h >>> 0;
		const j = h % (i + 1);
		[indices[i], indices[j]] = [indices[j], indices[i]];
	}
	const reordered = indices.map((i) => options[i]);
	return { options: reordered, correctIndex: reordered.indexOf(correctAnswer) };
}

/**
 * Predicate the caller passes to assert "this is the JSON object I asked
 * for". Returning true means accept; false means keep trying the next
 * candidate. Used to distinguish "thinking with code that happens to be
 * valid JSON" from "the actual answer object" without hard-coding which
 * provider emits which.
 */
type ShapeValidator = (parsed: unknown) => boolean;

function parseJsonObject(raw: string, validator: ShapeValidator = () => true): unknown {
	const cleaned = stripFences(stripInvisibles(raw)).trim();
	if (looksLikeRefusal(cleaned) && !cleaned.includes('{')) {
		throw new Error(
			"The model refused to generate questions for this context. This usually means the workspace is too small or generic. Try opening a richer file or selecting a specific code block, then run 'Quiz Me On Selection'."
		);
	}

	// Walk every balanced `{...}` candidate in order. For each, try strict
	// parse, then a tolerant repair-and-retry. The FIRST candidate that
	// (a) parses AND (b) matches the caller's expected shape wins.
	//
	// This is the bulletproof part: it doesn't matter if the response is
	// `<thinking with code that contains balanced braces>{actual answer}`
	// from Gemini, or `<reasoning>{ans}` from o1, or `<safety prefix>{ans}`
	// from any future model. As long as the actual answer is *somewhere*
	// in the response and matches our shape, we find it.
	const candidates = extractAllJsonObjects(cleaned);
	let lastErr: Error | null = null;
	let firstParseable: { parsed: unknown; source: string } | null = null;

	for (const candidate of candidates) {
		const parsed = tryParseAndRepair(candidate);
		if (!parsed.ok) {
			lastErr = parsed.err;
			continue;
		}
		if (!firstParseable) {
			firstParseable = { parsed: parsed.value, source: candidate };
		}
		if (validator(parsed.value)) {
			return parsed.value;
		}
	}

	// Nothing matched the validator. If we DID find something parseable
	// (just wrong shape), prefer returning that with a warning over
	// throwing — old behavior compatibility for tests that don't pass a
	// validator. Callers that pass a validator should reject themselves.
	if (firstParseable && validator === undefined) {
		return firstParseable.parsed;
	}
	if (firstParseable) {
		// Caller passed a validator but no candidate matched. Most likely:
		// the model emitted thinking-then-answer but the answer got cut off,
		// OR the model wrapped the answer in an unexpected envelope.
		console.error(
			'[VibeCheck] Found JSON, but no candidate matched the expected shape.',
			'\nFirst parseable candidate:\n' + firstParseable.source.slice(0, 500),
			'\nRaw response (first 2000 chars):\n' + raw.slice(0, 2000)
		);
		throw new Error(
			'The AI returned JSON, but not in the expected format. ' +
				`Got: "${JSON.stringify(firstParseable.parsed).slice(0, 160)}…" — ` +
				'this usually means the model is "thinking out loud" instead of answering. ' +
				'Try a model with less reasoning overhead (e.g. `gemini-2.5-flash-lite`, `claude-haiku-4-5`, `gpt-5.4-mini`).'
		);
	}

	// Nothing parsed at all.
	if (lastErr) {
		console.error('[VibeCheck] JSON parse failed. Raw response:\n' + raw.slice(0, 2000));
		throw new Error(buildParseError(lastErr, raw));
	}
	if (looksLikeRefusal(cleaned)) {
		throw new Error(
			"The model refused to generate questions for this context. Try opening a richer file or selecting a specific code block, then run 'Quiz Me On Selection'."
		);
	}
	console.error('[VibeCheck] No JSON object found in response. Raw:\n' + raw.slice(0, 2000));
	throw new Error(`Response was not JSON. Model returned: ${cleaned.slice(0, 200) || '(empty)'}`);
}

/** Best-effort parse with one auto-repair retry. Pure function. */
function tryParseAndRepair(candidate: string):
	| { ok: true; value: unknown }
	| { ok: false; err: Error } {
	try {
		return { ok: true, value: JSON.parse(candidate) };
	} catch (err) {
		const repaired = repairJson(candidate);
		if (repaired !== candidate) {
			try {
				return { ok: true, value: JSON.parse(repaired) };
			} catch {
				/* fall through */
			}
		}
		return { ok: false, err: err as Error };
	}
}

/** Build a parse-error message that surfaces a snippet of what the model actually said. */
function buildParseError(err: Error, raw: string): string {
	const snippet = raw.slice(0, 160).replace(/\s+/g, ' ').trim();
	return (
		`The AI returned something that wasn't valid JSON. ` +
		`Parser said: "${err.message}". ` +
		`Model output started with: "${snippet || '(empty)'}…" ` +
		`This is a model issue, not Vibe Check — try a different model (e.g. ${'`'}gemini-2.5-flash-lite${'`'} for less thinking overhead, or switch provider).`
	);
}

/** Strip Unicode BOM and zero-width characters that some models prefix. */
function stripInvisibles(s: string): string {
	return s.replace(/^[﻿​‌‍ ]+/, '');
}

/** Find the first top-level balanced-brace JSON object in `s`. Skips '{' inside strings. */
/**
 * Find ALL balanced `{...}` objects in the input, in order. Tracks BOTH
 * `"`-delimited and `'`-delimited strings so a `}` inside a single-quoted
 * string doesn't close the object early (the actual bug that hit Gemini).
 *
 * Yields each candidate as a substring slice. Caller decides which ones
 * to attempt to parse. Linear time over the whole input.
 */
function extractAllJsonObjects(s: string): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < s.length) {
		if (s[i] !== '{') {
			i++;
			continue;
		}
		// Walk from this '{' looking for balanced close.
		let depth = 0;
		let inString: '"' | "'" | null = null;
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
			// Unbalanced from this '{' — advance past it and keep scanning.
			i++;
			continue;
		}
		out.push(s.slice(i, end + 1));
		// Skip past this object so we look for SIBLING objects, not nested.
		i = end + 1;
	}
	return out;
}

/** Best-effort repair of common LLM JSON mistakes. Conservative — only safe transforms. */
function repairJson(s: string): string {
	let out = s;
	// Smart / curly quotes → ASCII. Some providers (Gemini in particular) lift
	// these from prose context and they are NOT valid JSON.
	out = out
		.replace(/[“”„‟]/g, '"') // " " „ ‟
		.replace(/[‘’‚‛]/g, "'"); // ' ' ‚ ‛
	// Strip line/block comments that some models leave in (// ... or /* ... */).
	out = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
	// Single-quoted string literals → double-quoted. Walk the string char by
	// char so we don't touch single quotes inside double-quoted strings (which
	// are legal JSON, e.g. "don't"). Within the converted string, escape any
	// existing double-quotes.
	out = convertSingleQuotedStrings(out);
	// Trailing commas before } or ]
	out = out.replace(/,(\s*[}\]])/g, '$1');
	// Unquoted property names — e.g. {questions: [...]} → {"questions": [...]}
	// Match `{` or `,` followed by whitespace + identifier + `:`. Only ASCII identifiers.
	out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
	return out;
}

/**
 * Convert single-quoted JSON string literals to double-quoted. Skips content
 * inside existing double-quoted strings so apostrophes there are preserved.
 */
function convertSingleQuotedStrings(s: string): string {
	let out = '';
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === '"') {
			// Skip over a double-quoted string verbatim (respecting escapes).
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
			// Convert this single-quoted run to double-quoted.
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
					// Escape any literal double-quote that ended up inside.
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

function looksLikeRefusal(text: string): boolean {
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

function stripFences(s: string): string {
	return s
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/i, '')
		.trim();
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Slice context-relative lines (1-indexed inclusive) from the raw module context. */
function sliceContextLines(context: string, range?: LineRange): string | undefined {
	if (!range) {
		return undefined;
	}
	const lines = context.split('\n');
	const start = Math.max(0, range.start - 1);
	const end = Math.min(lines.length, range.end);
	if (end <= start) {
		return undefined;
	}
	return lines.slice(start, end).join('\n');
}
