/**
 * Canonical event-name catalog. Keep this list flat and stable so the
 * dashboard can rely on it. Adding new events is safe; renaming is not —
 * you'd lose continuity in time-series charts.
 *
 * **Privacy contract**: every property documented here is anonymous and
 * non-identifying. Never add a property whose value is user code, file
 * content, file paths from the workspace, API keys, or anything that could
 * be reversed back to a person. Lengths, counts, durations, type strings,
 * and enum values only.
 */

export type EventName =
	// Lifecycle
	| 'extension.activated'
	| 'extension.deactivated'
	| 'host.detected'

	// Consent
	| 'consent.prompted'
	| 'consent.granted'
	| 'consent.denied'

	// Setup / onboarding
	| 'walkthrough.opened'
	| 'walkthrough.fallback_toast_shown'
	| 'provider.configure_started'
	| 'provider.configure_completed'
	| 'provider.configure_canceled'
	| 'provider.api_key_set'
	| 'provider.api_key_cleared'
	| 'provider.switched'
	| 'provider.model_selected'
	| 'provider.fallback_used'

	// Module lifecycle
	| 'module.generation_started'
	| 'module.generation_completed'
	| 'module.generation_failed'
	| 'module.opened'
	| 'module.completed'
	| 'module.abandoned'
	| 'lesson.started'
	| 'lesson.exited'
	| 'lesson.completed'

	// Question lifecycle
	| 'question.shown'
	| 'question.answered'
	| 'question.why_clicked'
	| 'question.code_ref_clicked'
	| 'question.code_show_clicked'
	| 'question.tried_again'

	// Review
	| 'review.started'
	| 'review.completed'
	| 'review.empty'

	// Track / progression
	| 'track.switched'
	| 'progress.daily_goal_met'
	| 'progress.streak_extended'
	| 'progress.streak_broken'
	| 'progress.streak_freeze_used'
	| 'progress.streak_freeze_earned'
	| 'progress.reset'

	// Module deletion / question rating / cancellation / prefetch (v0.1.1)
	| 'module.deleted'
	| 'module.generation_cancelled'
	| 'question.rated'
	| 'lesson.prefetch_completed'

	// Pulse (auto-detection of AI insertions)
	| 'pulse.observed'
	| 'pulse.dismissed'
	| 'pulse.auto_fired'
	| 'pulse.prompted'

	// LLM transport
	| 'llm.request_started'
	| 'llm.request_succeeded'
	| 'llm.request_failed'

	// UI clicks (sidebar)
	| 'sidebar.opened'
	| 'sidebar.button_clicked'
	| 'sidebar.picker_opened'

	// Commands
	| 'command.invoked'

	// Settings
	| 'setting.changed'

	// Errors
	| 'error.thrown';

/* ============================================================
   Property schemas (typed by event name).
   Keep all values primitives — strings, numbers, booleans.
   No nested objects beyond one level. No user-supplied strings.
   ============================================================ */

export interface EventPropMap {
	'extension.activated': { firstRun: boolean; secondsSinceLastActivation?: number };
	'extension.deactivated': { sessionDurationMs: number };
	'host.detected': { host: string; appName: string };

	'consent.prompted': { trigger: 'first-run' | 'command' };
	'consent.granted': { trigger: 'first-run' | 'command' };
	'consent.denied': { trigger: 'first-run' | 'command' };

	'walkthrough.opened': { source: 'first-run' | 'command' };
	'walkthrough.fallback_toast_shown': Record<string, never>;

	'provider.configure_started': { from: 'wizard' | 'command' | 'walkthrough' };
	'provider.configure_completed': { provider: string; model: string };
	'provider.configure_canceled': { atStep: 'provider' | 'apiKey' | 'model' };
	'provider.api_key_set': { provider: string };
	'provider.api_key_cleared': { provider: string };
	'provider.switched': { from: string; to: string };
	'provider.model_selected': { provider: string; model: string; isCustom: boolean };
	'provider.fallback_used': { wanted: string; actual: string };

	'module.generation_started': {
		topic: string;
		track: string;
		source: 'manual' | 'auto-pulse' | 'selection';
		mixed: boolean;
		contextChars: number;
		lessonCount: number;
		questionsPerLesson: number;
	};
	'module.generation_completed': { topic: string; track: string; durationMs: number; lessons: number };
	'module.generation_failed': { topic: string; track: string; provider: string; errorClass: string };
	'module.opened': { lessonsTotal: number; lessonsCompleted: number };
	'module.completed': { totalLessons: number; totalQuestions: number };
	'module.abandoned': { atLessonIndex: number; lessonsCompleted: number; totalLessons: number };

	'lesson.started': { lessonIndex: number; questionCount: number; track: string; topic: string; isReview: boolean };
	'lesson.exited': { lessonIndex: number; answeredCount: number; totalQuestions: number };
	'lesson.completed': {
		lessonIndex: number;
		correct: number;
		total: number;
		passed: boolean;
		track: string;
		topic: string;
		durationMs: number;
		isReview: boolean;
	};

	'question.shown': {
		type: 'multiple-choice' | 'code-order' | 'fill-blank';
		track: string;
		topic: string;
		lessonIndex: number;
		questionIndex: number;
		isReview: boolean;
		hasCodeSnippet: boolean;
	};
	'question.answered': {
		type: 'multiple-choice' | 'code-order' | 'fill-blank';
		track: string;
		topic: string;
		correct: boolean;
		durationMs: number;
		attempts: number;
		isReview: boolean;
	};
	'question.why_clicked': { type: string; wasCorrect: boolean };
	'question.code_ref_clicked': { type: string };
	'question.code_show_clicked': { type: string };
	'question.tried_again': { type: string };

	'review.started': { dueCount: number; track: string };
	'review.completed': { cardsReviewed: number; correct: number; durationMs: number; track: string };
	'review.empty': { track: string };

	'track.switched': { from: string; to: string };
	'progress.daily_goal_met': { track: string; dailyXp: number };
	'progress.streak_extended': { track: string; streakDays: number };
	'progress.streak_broken': { track: string; previousStreak: number };
	'progress.streak_freeze_used': {
		track: string;
		freezesConsumed: number;
		freezesRemaining: number;
		gapDays: number;
	};
	'progress.streak_freeze_earned': {
		track: string;
		earned: number;
		freezesAvailable: number;
		streakDays: number;
	};
	'progress.reset': Record<string, never>;

	'module.deleted': { questionsRemoved: number; deleted: boolean };
	'module.generation_cancelled': Record<string, never>;
	'question.rated': { rating: 'up' | 'down'; type: string };
	'lesson.prefetch_completed': { lessonIndex: number; durationMs: number };

	'pulse.observed': { chars: number; lines: number; autoQuiz: boolean };
	'pulse.dismissed': Record<string, never>;
	'pulse.auto_fired': { chars: number; lines: number };
	'pulse.prompted': { chars: number; lines: number; accepted: boolean };

	'llm.request_started': { provider: string; model: string; kind: 'skeleton' | 'lesson' | 'explain' };
	'llm.request_succeeded': {
		provider: string;
		model: string;
		kind: 'skeleton' | 'lesson' | 'explain';
		durationMs: number;
		responseChars: number;
	};
	'llm.request_failed': {
		provider: string;
		model: string;
		kind: 'skeleton' | 'lesson' | 'explain';
		durationMs: number;
		errorClass: string;
		statusCode?: number;
	};

	'sidebar.opened': Record<string, never>;
	'sidebar.button_clicked': { button: string; screen: string };
	'sidebar.picker_opened': Record<string, never>;

	'command.invoked': { command: string };

	'setting.changed': { key: string; valueClass: string };

	'error.thrown': { location: string; errorClass: string; provider?: string };
}

export type AnyEventProps = {
	[K in EventName]: { name: K } & EventPropMap[K];
}[EventName];
