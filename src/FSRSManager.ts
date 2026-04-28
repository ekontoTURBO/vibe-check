import * as vscode from 'vscode';
import { FSRS, fsrs, createEmptyCard, Rating, Card, Grade } from 'ts-fsrs';
import {
	Module,
	ModuleLesson,
	ModuleSummary,
	ProgressState,
	Question,
	StoredCard,
	Track,
	TRACKS,
	TrackProgress,
} from './types';

const CARDS_KEY = 'vibeCheck.cards.v3';
const PROGRESS_KEY = 'vibeCheck.progress.v3';
const MODULES_KEY = 'vibeCheck.modules.v3';

const PASS_THRESHOLD = 0.8; // 4/5 correct to pass a lesson

const EMPTY_TRACK: TrackProgress = {
	xp: 0,
	streak: 0,
	lastReviewDate: null,
	totalAnswered: 0,
	totalCorrect: 0,
	dailyXp: 0,
	dailyXpDate: null,
};

const DAILY_GOAL = 50;

const DEFAULT_PROGRESS: ProgressState = {
	tracks: {
		beginner: { ...EMPTY_TRACK },
		intermediate: { ...EMPTY_TRACK },
		expert: { ...EMPTY_TRACK },
	},
	activeTrack: 'beginner',
};

interface SerializedStoredCard {
	question: Question;
	card: Omit<Card, 'due' | 'last_review'> & {
		due: string;
		last_review?: string;
	};
}

export class FSRSManager {
	private scheduler: FSRS;

	constructor(private context: vscode.ExtensionContext) {
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

	listModules(track: Track): ModuleSummary[] {
		return this.loadModules()
			.filter((m) => m.track === track)
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

	dueCards(track: Track, now = new Date()): StoredCard[] {
		return this.loadCards().filter(
			(c) => c.question.track === track && c.card.due.getTime() <= now.getTime()
		);
	}

	getProgress(): ProgressState {
		const stored = this.context.globalState.get<ProgressState>(PROGRESS_KEY);
		if (!stored) {
			return cloneProgress(DEFAULT_PROGRESS);
		}
		const today = dateKey(new Date());
		const tracks: ProgressState['tracks'] = {
			beginner: normalizeTrack(stored.tracks?.beginner, today),
			intermediate: normalizeTrack(stored.tracks?.intermediate, today),
			expert: normalizeTrack(stored.tracks?.expert, today),
		};
		const activeTrack = TRACKS.includes(stored.activeTrack) ? stored.activeTrack : 'beginner';
		return { tracks, activeTrack };
	}

	getDailyGoal(): number {
		return DAILY_GOAL;
	}

	async setActiveTrack(track: Track): Promise<ProgressState> {
		const prev = this.getProgress();
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
		const trackPrev = prev.tracks[track];
		const today = dateKey(new Date());
		const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

		let streak = trackPrev.streak;
		if (trackPrev.lastReviewDate !== today) {
			if (trackPrev.lastReviewDate === yesterday || trackPrev.lastReviewDate === null) {
				streak = correct ? trackPrev.streak + 1 : Math.max(0, trackPrev.streak);
			} else {
				streak = correct ? 1 : 0;
			}
		}

		const dailyReset = trackPrev.dailyXpDate !== today;
		const updatedTrack: TrackProgress = {
			xp: trackPrev.xp + xpDelta,
			streak,
			lastReviewDate: today,
			totalAnswered: trackPrev.totalAnswered + 1,
			totalCorrect: trackPrev.totalCorrect + (correct ? 1 : 0),
			dailyXp: (dailyReset ? 0 : trackPrev.dailyXp) + xpDelta,
			dailyXpDate: today,
		};

		const next: ProgressState = {
			...prev,
			tracks: { ...prev.tracks, [track]: updatedTrack },
		};
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
		tracks: {
			beginner: { ...p.tracks.beginner },
			intermediate: { ...p.tracks.intermediate },
			expert: { ...p.tracks.expert },
		},
	};
}

function normalizeTrack(raw: Partial<TrackProgress> | undefined, today: string): TrackProgress {
	const base: TrackProgress = { ...EMPTY_TRACK, ...(raw ?? {}) };
	if (base.dailyXpDate !== today) {
		base.dailyXp = 0;
	}
	return base;
}

function dateKey(d: Date): string {
	return d.toISOString().slice(0, 10);
}
