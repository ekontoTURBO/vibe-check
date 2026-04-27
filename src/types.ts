import type { Card } from 'ts-fsrs';

export type Track = 'beginner' | 'intermediate' | 'expert';
export const TRACKS: Track[] = ['beginner', 'intermediate', 'expert'];

export type Topic = 'code' | 'infrastructure' | 'tools' | 'architecture' | 'security';
export const TOPICS: Topic[] = ['code', 'infrastructure', 'tools', 'architecture', 'security'];

export type Environment = 'antigravity' | 'vscode';

export type LessonState = 'locked' | 'available' | 'completed';

export interface LineRange {
	start: number;
	end: number;
}

export interface BaseQuestion {
	id: string;
	prompt: string;
	explanation: string;
	track: Track;
	topic: Topic;
	moduleId: string;
	lessonId: string;
	sourceFile?: string;
	lineRange?: LineRange;
	createdAt: number;
}

export interface MultipleChoiceQuestion extends BaseQuestion {
	type: 'multiple-choice';
	options: string[];
	correctIndex: number;
}

export interface CodeOrderQuestion extends BaseQuestion {
	type: 'code-order';
	correctSequence: string[];
}

export type Question = MultipleChoiceQuestion | CodeOrderQuestion;
export type QuestionType = Question['type'];

export interface ModuleLesson {
	id: string;
	index: number; // 0..4
	title: string;
	objective: string;
	state: LessonState;
	questions?: Question[]; // lazily generated
	bestScore?: number; // best correct/total ratio achieved
}

export interface Module {
	id: string;
	title: string;
	topic: Topic;
	track: Track;
	lessons: ModuleLesson[]; // exactly 5
	context: string; // saved for lazy lesson generation
	contextLabel: string;
	sourceFile?: string;
	baseLine: number;
	createdAt: number;
}

export interface ModuleSummary {
	id: string;
	title: string;
	topic: Topic;
	track: Track;
	createdAt: number;
	lessons: Array<{
		index: number;
		title: string;
		state: LessonState;
		bestScore?: number;
	}>;
	completedCount: number;
}

export interface StoredCard {
	question: Question;
	card: Card;
}

export interface TrackProgress {
	xp: number;
	streak: number;
	lastReviewDate: string | null;
	totalAnswered: number;
	totalCorrect: number;
	dailyXp: number;
	dailyXpDate: string | null;
}

export interface ProgressState {
	tracks: Record<Track, TrackProgress>;
	activeTrack: Track;
}

export interface QuizSession {
	moduleId: string;
	lessonId: string;
	title: string;
	topic: Topic;
	track: Track;
	questions: Question[];
	currentIndex: number;
	startedAt: number;
	isReview: boolean;
}

export interface AgentArtifact {
	plan?: string;
	files?: string[];
	rationale?: string;
	timestamp: number;
}

export interface Capabilities {
	hasActiveEditor: boolean;
	hasWorkspaceFolder: boolean;
	hasPackageJson: boolean;
}

export type AnswerPayload =
	| { kind: 'multiple-choice'; choiceIndex: number }
	| { kind: 'code-order'; sequence: string[] };

export type WebviewMessage =
	| { type: 'requestState' }
	| { type: 'submitAnswer'; questionId: string; answer: AnswerPayload }
	| { type: 'finalizeQuestion'; questionId: string; outcome: 'correct' | 'wrong' }
	| { type: 'startLesson'; moduleId: string; lessonId: string }
	| { type: 'startReview' }
	| { type: 'generateModule'; topic: Topic }
	| { type: 'setTrack'; track: Track }
	| { type: 'glowQuestion'; questionId: string }
	| { type: 'dismissSession' };

export type ExtensionMessage =
	| { type: 'state'; payload: SidebarState }
	| {
			type: 'feedback';
			questionId: string;
			correct: boolean;
			explanation: string;
			xpDelta: number;
			correctAnswer: string;
	  }
	| { type: 'sessionStarted'; session: QuizSession }
	| { type: 'sessionFinished'; passed: boolean; score: number; total: number }
	| { type: 'moduleGenerating'; topic: Topic; track: Track }
	| { type: 'lessonGenerating'; lessonId: string }
	| { type: 'error'; message: string };

export interface SidebarState {
	progress: ProgressState;
	activeSession: QuizSession | null;
	modules: ModuleSummary[];
	dueCount: number;
	environment: Environment;
	isGenerating: boolean;
	capabilities: Capabilities;
}
