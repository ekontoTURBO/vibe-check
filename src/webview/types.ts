import type {
	Question,
	Topic,
	Track,
	ModuleSummary,
	LessonState,
	Environment,
	Capabilities,
} from '../types';

export type {
	Question,
	Topic,
	Track,
	ModuleSummary,
	LessonState,
	Environment,
	Capabilities,
};

export interface ViewProgress {
	xp: number;
	streak: number;
	dailyXp: number;
	dailyGoal: number;
	rank: string | null;
	totalAnswered: number;
	totalCorrect: number;
	freezesAvailable: number;
}

export interface ModulePathLesson {
	id: string;
	index: number;
	title: string;
	state: LessonState;
	bestScore?: number;
}

export interface ActiveModuleDetail {
	id: string;
	title: string;
	topic: Topic;
	track: Track;
	contextLabel: string;
	sourceFile?: string;
	lessons: ModulePathLesson[];
	completedCount: number;
}

export interface ActiveLessonState {
	moduleId: string;
	lessonId: string;
	moduleTitle: string;
	moduleSourceFile?: string;
	lessonTitle: string;
	lessonObjective: string;
	lessonIndex: number;
	totalLessons: number;
	topic: Topic;
	track: Track;
	isReview: boolean;
	questions: Question[];
	currentIndex: number;
}

export type Screen =
	| { kind: 'home' }
	| { kind: 'path'; moduleId: string }
	| { kind: 'lesson' }
	| { kind: 'complete'; correct: number; total: number; xpEarned: number; passed: boolean }
	| { kind: 'picker' };

export interface PulseInfo {
	chars: number;
	lines: number;
	when: number;
}

export interface ViewState {
	screen: Screen;
	track: Track;
	progress: ViewProgress;
	modules: ModuleSummary[];
	activeModule: ActiveModuleDetail | null;
	activeLesson: ActiveLessonState | null;
	dueCount: number;
	environment: Environment;
	isGenerating: boolean;
	generatingTopic?: Topic;
	capabilities: Capabilities;
	pulse: PulseInfo | null;
	error: string | null;
	feedback: FeedbackUiState | null;
}

export interface FeedbackUiState {
	questionId: string;
	correct: boolean;
	canonicalMessage: string;
	personalizedMessage: string | null;
	personalizedLoading: boolean;
	personalizedRequested: boolean;
	userAnswerText: string;
	correctAnswerText: string;
	xpDelta: number;
}

/* =========== Webview → Host messages =========== */

export type AnswerPayload =
	| { kind: 'multiple-choice'; choiceIndex: number }
	| { kind: 'code-order'; sequence: string[] }
	| { kind: 'fill-blank'; choiceIndex: number };

export type ClientMessage =
	| { type: 'ready' }
	| { type: 'setTrack'; track: Track }
	| { type: 'openModule'; moduleId: string }
	| { type: 'closeModule' }
	| { type: 'openPicker' }
	| { type: 'closePicker' }
	| { type: 'newModule'; topic: Topic }
	| { type: 'deleteModule'; moduleId: string }
	| { type: 'cancelGeneration' }
	| { type: 'rateQuestion'; questionId: string; rating: 'up' | 'down' }
	| { type: 'startLesson'; moduleId: string; lessonId: string }
	| { type: 'startReview' }
	| { type: 'submitAnswer'; questionId: string; answer: AnswerPayload; correct: boolean }
	| { type: 'requestWrongFeedback'; questionId: string; userAnswerText: string }
	| { type: 'tryAgain'; questionId: string }
	| { type: 'finalizeQuestion'; questionId: string; outcome: 'correct' | 'wrong' }
	| { type: 'exitLesson' }
	| { type: 'revealLines'; file: string; startLine: number; endLine: number }
	| { type: 'revealSnippet'; snippet: string; file?: string }
	| { type: 'openExternal'; url: string }
	| { type: 'dismissPulse' }
	| { type: 'dismissError' }
	| { type: 'completeAcknowledged' };

/* =========== Host → Webview messages =========== */

export type HostMessage =
	| { type: 'state'; state: ViewState }
	| { type: 'wrongFeedback'; questionId: string; message: string }
	| { type: 'error'; message: string };
