import * as vscode from 'vscode';
import { FSRS, fsrs, createEmptyCard, Rating, Card, Grade } from 'ts-fsrs';
import { Telemetry } from './telemetry/Telemetry';
import {
	Module,
	ModuleLesson,
	ModuleSummary,
	ProgressState,
	Question,
	StoredCard,
	Track,
	TRACKS,
	UserProgress,
} from './types';

const CARDS_KEY = 'vibeCheck.cards.v3';
const PROGRESS_KEY = 'vibeCheck.progress.v3';
const MODULES_KEY = 'vibeCheck.modules.v3';

const PASS_THRESHOLD = 0.8; // 4/5 correct to pass a lesson
const MAX_FREEZES = 3;
const FREEZE_EARN_EVERY_DAYS = 7;

const EMPTY_PROGRESS: UserProgress = {
	xp: 0,
	streak: 0,
	lastReviewDate: null,
	totalAnswered: 0,
	totalCorrect: 0,
	dailyXp: 0,
	dailyXpDate: null,
	freezesAvailable: 0,
};

const DAILY_GOAL = 50;

const DEFAULT_PROGRESS: ProgressState = {
	progress: { ...EMPTY_PROGRESS },
	activeTrack: 'beginner',
};

/** Shape of pre-v0.1.1 stored progress with one entry per track. */
interface LegacyTrackProgress {
	xp: number;
	streak: number;
	lastReviewDate: string | null;
	totalAnswered: number;
	totalCorrect: number;
	dailyXp: number;
	dailyXpDate: string | null;
}
interface LegacyProgressState {
	tracks?: Partial<Record<Track, Partial<LegacyTrackProgress>>>;
	progress?: UserProgress;
	activeTrack?: Track;
}

interface SerializedStoredCard {
	question: Question;
	card: Omit<Card, 'due' | 'last_review'> & {
		due: string;
		last_review?: string;
	};
}

export class FSRSManager {
	private scheduler: FSRS;

	constructor(private context: vscode.ExtensionContext, private telemetry?: Telemetry) {
		this.scheduler = fsrs();
	}

	addModule(module: Module): void {
		const modules = this.loadModules();
		modules.push(module);
		void this.context.workspaceState.update(MODULES_KEY, modules);
	}

	getModule(id: string): Module | undefined {
		return this.loadModules().find((m) => m.id === id);
	}

	/** Lists ALL modules in this workspace regardless of difficulty track. */
	listModules(): ModuleSummary[] {
		return this.loadModules()
			.sort((a, b) => b.createdAt - a.createdAt)
			.map((m) => ({
				id: m.id,
				title: m.title,
				topic: m.topic,
				track: m.track,
				createdAt: m.createdAt,
				lessons: m.lessons.map((l) => ({
					index: l.index,
					title: l.title,
					state: l.state,
					bestScore: l.bestScore,
				})),
				completedCount: m.lessons.filter((l) => l.state === 'completed').length,
			}));
	}

	saveLessonQuestions(moduleId: string, lessonId: string, questions: Question[]): void {
		const modules = this.loadModules();
		const m = modules.find((mm) => mm.id === moduleId);
		if (!m) {
			return;
		}
		const l = m.lessons.find((ll) => ll.id === lessonId);
		if (!l) {
			return;
		}
		l.questions = questions;
		void this.context.workspaceState.update(MODULES_KEY, modules);

		const cards = this.loadCards();
		for (const q of questions) {
			if (!cards.some((c) => c.question.id === q.id)) {
				cards.push({ question: q, card: createEmptyCard<Card>(new Date()) });
			}
		}
		this.saveCards(cards);
	}

	getLesson(moduleId: string, lessonId: string): { module: Module; lesson: ModuleLesson } | null {
		const m = this.getModule(moduleId);
		if (!m) {
			return null;
		}
		const l = m.lessons.find((ll) => ll.id === lessonId);
		if (!l) {
			return null;
		}
		return { module: m, lesson: l };
	}

	/**
	 * Records the outcome of completing a lesson session.
	 * If score meets PASS_THRESHOLD, marks the lesson completed and unlocks the next.
	 * Returns whether the lesson was passed.
	 */
	recordLessonResult(
		moduleId: string,
		lessonId: string,
		correctCount: number,
		totalCount: number
	): { passed: boolean } {
		if (totalCount === 0) {
			return { passed: false };
		}
		const ratio = correctCount / totalCount;
		const passed = ratio >= PASS_THRESHOLD;

		const modules = this.loadModules();
		const m = modules.find((mm) => mm.id === moduleId);
		if (!m) {
			return { passed };
		}
		const idx = m.lessons.findIndex((ll) => ll.id === lessonId);
		if (idx === -1) {
			return { passed };
		}
		const lesson = m.lessons[idx];
		lesson.bestScore = Math.max(lesson.bestScore ?? 0, ratio);

		if (passed && lesson.state !== 'completed') {
			lesson.state = 'completed';
			const next = m.lessons[idx + 1];
			if (next && next.state === 'locked') {
				next.state = 'available';
			}
		}

		void this.context.workspaceState.update(MODULES_KEY, modules);
		return { passed };
	}

	allCards(): StoredCard[] {
		return this.loadCards();
	}

	/** Removes a module and its associated FSRS review cards. Returns whether anything was deleted. */
	deleteModule(moduleId: string): { deleted: boolean; questionsRemoved: number } {
		const modules = this.loadModules();
		const idx = modules.findIndex((m) => m.id === moduleId);
		if (idx === -1) {
			return { deleted: false, questionsRemoved: 0 };
		}
		const removedQuestionIds = new Set<string>();
		for (const lesson of modules[idx].lessons) {
			for (const q of lesson.questions ?? []) {
				removedQuestionIds.add(q.id);
			}
		}
		modules.splice(idx, 1);
		void this.context.workspaceState.update(MODULES_KEY, modules);

		if (removedQuestionIds.size > 0) {
			const cards = this.loadCards().filter((c) => !removedQuestionIds.has(c.question.id));
			this.saveCards(cards);
		}
		return { deleted: true, questionsRemoved: removedQuestionIds.size };
	}

	/** Returns ALL due cards regardless of difficulty track. */
	dueCards(now = new Date()): StoredCard[] {
		return this.loadCards().filter((c) => c.card.due.getTime() <= now.getTime());
	}

	getProgress(): ProgressState {
		const stored = this.context.globalState.get<LegacyProgressState>(PROGRESS_KEY);
		if (!stored) {
			return cloneProgress(DEFAULT_PROGRESS);
		}
		const today = dateKey(new Date());
		const activeTrack: Track =
			stored.activeTrack && TRACKS.includes(stored.activeTrack) ? stored.activeTrack : 'beginner';

		// Migration path: stored data from before v0.1.1 had per-track progress.
		// Combine into a single shared pool. Sum lifetime counters, take max streak,
		// and only carry today's dailyXp (entries from prior days reset).
		if (!stored.progress && stored.tracks) {
			const t = stored.tracks;
			const merged: UserProgress = {
				xp: (t.beginner?.xp ?? 0) + (t.intermediate?.xp ?? 0) + (t.expert?.xp ?? 0),
				streak: Math.max(
					t.beginner?.streak ?? 0,
					t.intermediate?.streak ?? 0,
					t.expert?.streak ?? 0
				),
				lastReviewDate: latestDate([
					t.beginner?.lastReviewDate ?? null,
					t.intermediate?.lastReviewDate ?? null,
					t.expert?.lastReviewDate ?? null,
				]),
				totalAnswered:
					(t.beginner?.totalAnswered ?? 0) +
					(t.intermediate?.totalAnswered ?? 0) +
					(t.expert?.totalAnswered ?? 0),
				totalCorrect:
					(t.beginner?.totalCorrect ?? 0) +
					(t.intermediate?.totalCorrect ?? 0) +
					(t.expert?.totalCorrect ?? 0),
				dailyXp:
					(t.beginner?.dailyXpDate === today ? t.beginner.dailyXp ?? 0 : 0) +
					(t.intermediate?.dailyXpDate === today ? t.intermediate.dailyXp ?? 0 : 0) +
					(t.expert?.dailyXpDate === today ? t.expert.dailyXp ?? 0 : 0),
				dailyXpDate: today,
			};
			return { progress: normalizeProgress(merged, today), activeTrack };
		}

		return {
			progress: normalizeProgress(stored.progress, today),
			activeTrack,
		};
	}

	getDailyGoal(): number {
		return DAILY_GOAL;
	}

	async setActiveTrack(track: Track): Promise<ProgressState> {
		const prev = this.getProgress();
		if (prev.activeTrack !== track) {
			this.telemetry?.track('track.switched', { from: prev.activeTrack, to: track });
		}
		const next: ProgressState = { ...prev, activeTrack: track };
		await this.context.globalState.update(PROGRESS_KEY, next);
		return next;
	}

	async grade(
		questionId: string,
		correct: boolean
	): Promise<{ xpDelta: number; progress: ProgressState }> {
		const cards = this.loadCards();
		const idx = cards.findIndex((c) => c.question.id === questionId);
		if (idx === -1) {
			throw new Error(`Unknown question: ${questionId}`);
		}

		const grade: Grade = correct ? Rating.Good : Rating.Again;
		const result = this.scheduler.next(cards[idx].card, new Date(), grade);
		cards[idx] = { ...cards[idx], card: result.card };
		this.saveCards(cards);

		const xpDelta = this.computeXp(correct, cards[idx].question.track);
		const progress = await this.updateProgress(cards[idx].question.track, correct, xpDelta);
		return { xpDelta, progress };
	}

	private computeXp(correct: boolean, track: Track): number {
		if (!correct) {
			return 0;
		}
		switch (track) {
			case 'beginner':
				return 5;
			case 'intermediate':
				return 10;
			case 'expert':
				return 20;
		}
	}

	private async updateProgress(
		track: Track,
		correct: boolean,
		xpDelta: number
	): Promise<ProgressState> {
		const prev = this.getProgress();
		const cur = prev.progress;
		const today = dateKey(new Date());

		let streak = cur.streak;
		let freezesAvailable = cur.freezesAvailable ?? 0;
		let freezesConsumed = 0;
		const dayGap = daysBetween(cur.lastReviewDate, today);

		if (dayGap === 0) {
			// Already reviewed today — streak unchanged.
		} else if (dayGap === 1 || cur.lastReviewDate === null) {
			// Yesterday or first ever review — clean continuation.
			streak = correct ? streak + 1 : Math.max(0, streak);
		} else {
			// Missed `dayGap - 1` days. Spend freezes to plug the gap if possible.
			const missed = dayGap - 1;
			if (streak > 0 && freezesAvailable >= missed) {
				freezesAvailable -= missed;
				freezesConsumed = missed;
				streak = correct ? streak + 1 : streak;
			} else {
				// Not enough freezes — streak breaks.
				streak = correct ? 1 : 0;
				freezesAvailable = Math.max(0, freezesAvailable - missed);
				freezesConsumed = Math.min(freezesAvailable + missed, missed);
			}
		}

		// Earn 1 freeze per 7-day streak milestone (7, 14, 21…) capped at MAX_FREEZES.
		const prevMilestones = Math.floor(cur.streak / FREEZE_EARN_EVERY_DAYS);
		const newMilestones = Math.floor(streak / FREEZE_EARN_EVERY_DAYS);
		const earned = Math.max(0, newMilestones - prevMilestones);
		if (earned > 0) {
			freezesAvailable = Math.min(MAX_FREEZES, freezesAvailable + earned);
		}

		const dailyReset = cur.dailyXpDate !== today;
		const updated: UserProgress = {
			xp: cur.xp + xpDelta,
			streak,
			lastReviewDate: today,
			totalAnswered: cur.totalAnswered + 1,
			totalCorrect: cur.totalCorrect + (correct ? 1 : 0),
			dailyXp: (dailyReset ? 0 : cur.dailyXp) + xpDelta,
			dailyXpDate: today,
			freezesAvailable,
		};

		// Streak transitions — telemetry still tags the difficulty that earned the change.
		if (streak > cur.streak) {
			this.telemetry?.track('progress.streak_extended', { track, streakDays: streak });
		} else if (streak === 0 && cur.streak > 0) {
			this.telemetry?.track('progress.streak_broken', { track, previousStreak: cur.streak });
		}
		if (freezesConsumed > 0) {
			this.telemetry?.track('progress.streak_freeze_used', {
				track,
				freezesConsumed,
				freezesRemaining: freezesAvailable,
				gapDays: dayGap,
			});
		}
		if (earned > 0) {
			this.telemetry?.track('progress.streak_freeze_earned', {
				track,
				earned,
				freezesAvailable,
				streakDays: streak,
			});
		}

		const prevDaily = dailyReset ? 0 : cur.dailyXp;
		if (prevDaily < DAILY_GOAL && updated.dailyXp >= DAILY_GOAL) {
			this.telemetry?.track('progress.daily_goal_met', { track, dailyXp: updated.dailyXp });
		}

		const next: ProgressState = { ...prev, progress: updated };
		await this.context.globalState.update(PROGRESS_KEY, next);
		return next;
	}

	async resetAll(): Promise<void> {
		// Per-project data
		await this.context.workspaceState.update(CARDS_KEY, []);
		await this.context.workspaceState.update(MODULES_KEY, []);
		// User-level data
		await this.context.globalState.update(PROGRESS_KEY, undefined);
		// Drop legacy globalState entries from before the per-project migration so
		// they don't bleed back in via the loadModulesLegacy() fallback below.
		await this.context.globalState.update(CARDS_KEY, undefined);
		await this.context.globalState.update(MODULES_KEY, undefined);
	}

	private loadModules(): Module[] {
		return this.context.workspaceState.get<Module[]>(MODULES_KEY) ?? [];
	}

	private loadCards(): StoredCard[] {
		const raw = this.context.workspaceState.get<SerializedStoredCard[]>(CARDS_KEY) ?? [];
		return raw.map((r) => ({
			question: r.question,
			card: {
				...r.card,
				due: new Date(r.card.due),
				last_review: r.card.last_review ? new Date(r.card.last_review) : undefined,
			} as Card,
		}));
	}

	private saveCards(cards: StoredCard[]): void {
		const serialized: SerializedStoredCard[] = cards.map((c) => ({
			question: c.question,
			card: {
				...c.card,
				due: c.card.due.toISOString(),
				last_review: c.card.last_review?.toISOString(),
			},
		}));
		void this.context.workspaceState.update(CARDS_KEY, serialized);
		// Only sync user-level XP/streak across devices — not per-project quizzes.
		void this.context.globalState.setKeysForSync([PROGRESS_KEY]);
	}
}

function cloneProgress(p: ProgressState): ProgressState {
	return {
		activeTrack: p.activeTrack,
		progress: { ...p.progress },
	};
}

function normalizeProgress(raw: Partial<UserProgress> | undefined, today: string): UserProgress {
	const base: UserProgress = { ...EMPTY_PROGRESS, ...(raw ?? {}) };
	if (base.dailyXpDate !== today) {
		base.dailyXp = 0;
	}
	return base;
}

function latestDate(dates: (string | null)[]): string | null {
	let best: string | null = null;
	for (const d of dates) {
		if (d && (best === null || d > best)) {
			best = d;
		}
	}
	return best;
}

function dateKey(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Returns the number of whole days between two YYYY-MM-DD strings.
 * `null` from is treated as Infinity (no prior reviews → streak start).
 */
function daysBetween(from: string | null, to: string): number {
	if (!from) {
		return Number.POSITIVE_INFINITY;
	}
	const fromMs = Date.parse(from + 'T00:00:00Z');
	const toMs = Date.parse(to + 'T00:00:00Z');
	if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}
