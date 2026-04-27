import { LLMService } from './LLMService';
import {
	CodeOrderQuestion,
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

interface ParsedSkeletonLesson {
	title: string;
	objective: string;
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

type ParsedQuestion = ParsedMC | ParsedCO;

export interface ModuleSkeletonOptions {
	topic: Topic;
	track: Track;
	context: string;
	contextLabel: string;
	sourceFile?: string;
	baseLine?: number;
}

export class TeacherProvider {
	constructor(private llm: LLMService) {}

	async generateModuleSkeleton(opts: ModuleSkeletonOptions): Promise<Module> {
		const system = this.buildSkeletonSystemPrompt(opts.topic, opts.track);
		const user = this.buildContextPrompt(opts.contextLabel, opts.context);
		const raw = await this.llm.complete({ system, user, maxTokens: 700 });
		const parsed = this.parseSkeleton(raw);

		const moduleId = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const lessons: ModuleLesson[] = parsed.lessons.map((l, i) => ({
			id: `${moduleId}-l${i}`,
			index: i,
			title: l.title,
			objective: l.objective,
			state: i === 0 ? 'available' : 'locked',
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
		const system = this.buildLessonSystemPrompt(module, lesson);
		const user = this.buildContextPrompt(module.contextLabel, module.context);
		const raw = await this.llm.complete({ system, user, maxTokens: 2000 });
		const parsed = this.parseQuestions(raw);

		return parsed.map((p, i) =>
			this.toQuestion(p, module, lesson, module.baseLine, i)
		);
	}

	private buildSkeletonSystemPrompt(topic: Topic, track: Track): string {
		return `You are designing a Duolingo-style MODULE for the "Vibe Check" extension. A module contains EXACTLY 5 sequential lessons that progress from surface-level to deep understanding. The learner will unlock lessons one at a time.

MODULE SPEC
- Topic: ${topic} — ${TOPIC_GUIDE[topic]}
- Track (difficulty): ${track} — ${TRACK_GUIDE[track]}

RETURN ONLY JSON (no fences, no prose):
{
  "title": "Module title (3-6 words capturing the core theme)",
  "lessons": [
    { "title": "Lesson 1 title (2-4 words)", "objective": "1 sentence describing what the learner will master in this lesson" },
    { "title": "Lesson 2 title", "objective": "..." },
    { "title": "Lesson 3 title", "objective": "..." },
    { "title": "Lesson 4 title", "objective": "..." },
    { "title": "Lesson 5 title", "objective": "..." }
  ]
}

RULES
- Lesson 1 = simplest: name things, identify, recognize. Lesson 5 = synthesis or hardest case.
- Each lesson covers a DISTINCT aspect of the context. No overlap.
- Match difficulty to the track. Beginner module = no expert-level lessons even at lesson 5.
- Lesson titles should be specific (e.g. "Async/await flow" not "Lesson 1").`;
	}

	private buildLessonSystemPrompt(module: Module, lesson: ModuleLesson): string {
		return `You are generating the 5 questions for ONE specific lesson in a Duolingo-style module. Use closed questions only (no free text).

MODULE: "${module.title}"
TOPIC: ${module.topic} — ${TOPIC_GUIDE[module.topic]}
TRACK: ${module.track} — ${TRACK_GUIDE[module.track]}

THIS LESSON (lesson ${lesson.index + 1} of 5)
- Title: "${lesson.title}"
- Objective: ${lesson.objective}

Generate EXACTLY 5 closed questions matching this lesson's objective and the track's difficulty.

QUESTION TYPES (mix freely):

1. multiple-choice — exactly 4 distinct options, exactly one correct.
   Distractors must be plausible. No "all of the above"-style filler.
   {
     "type": "multiple-choice",
     "prompt": "string",
     "options": ["a","b","c","d"],
     "correctIndex": 0,
     "explanation": "1-3 sentences justifying the correct answer",
     "lineRange": { "start": number, "end": number }   // OPTIONAL, 1-indexed within source context
   }

2. code-order — learner reorders shuffled lines into the correct sequence.
   Use for 3-7 line snippets where order is meaningful (control flow, async, lifecycle).
   Lines MUST be unique strings.
   {
     "type": "code-order",
     "prompt": "Reorder these lines to ...",
     "correctSequence": ["line1","line2","line3"],
     "explanation": "..."
   }

OUTPUT — raw JSON, no fences:
{ "questions": [ ... exactly 5 items ... ] }

RULES
- All questions must be answerable from the provided context.
- Stay focused on this lesson's objective. Do not drift into other lessons' material.
- Match difficulty to the track precisely.`;
	}

	private buildContextPrompt(label: string, context: string): string {
		return `CONTEXT (${label}):\n\n"""\n${context}\n"""\n\nGenerate now.`;
	}

	private parseSkeleton(raw: string): ParsedSkeleton {
		const obj = parseJsonObject(raw);
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
		if (lessons.length < 3) {
			throw new Error(`Module skeleton had ${lessons.length} valid lessons, need at least 3`);
		}
		// Pad to 5 if model returned fewer
		while (lessons.length < 5) {
			lessons.push({
				title: `Lesson ${lessons.length + 1}`,
				objective: 'Further practice on this topic',
			});
		}
		return { title, lessons: lessons.slice(0, 5) };
	}

	private parseQuestions(raw: string): ParsedQuestion[] {
		const obj = parseJsonObject(raw);
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
		baseLine: number,
		index: number
	): Question {
		const id = `q-${lesson.id}-${index}-${Math.random().toString(36).slice(2, 6)}`;
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
			topic: module.topic,
			moduleId: module.id,
			lessonId: lesson.id,
			sourceFile: module.sourceFile,
			lineRange,
			createdAt: Date.now(),
		};

		if (p.type === 'multiple-choice') {
			const q: MultipleChoiceQuestion = {
				...base,
				type: 'multiple-choice',
				options: p.options,
				correctIndex: p.correctIndex,
			};
			return q;
		}
		const q: CodeOrderQuestion = {
			...base,
			type: 'code-order',
			correctSequence: p.correctSequence,
		};
		return q;
	}
}

function parseJsonObject(raw: string): unknown {
	const cleaned = stripFences(raw).trim();
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(`Response was not JSON. Got: ${cleaned.slice(0, 200)}`);
	}
	const slice = cleaned.slice(start, end + 1);
	try {
		return JSON.parse(slice);
	} catch (err) {
		throw new Error(`JSON parse failed: ${(err as Error).message}`);
	}
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
