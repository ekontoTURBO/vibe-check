import type { Question, Track, ViewState, FeedbackUiState, Topic } from './types';

const EMPTY_STATE: ViewState = {
	screen: { kind: 'home' },
	track: 'beginner',
	progress: {
		xp: 0,
		streak: 0,
		dailyXp: 0,
		dailyGoal: 50,
		rank: null,
		totalAnswered: 0,
		totalCorrect: 0,
		freezesAvailable: 0,
	},
	modules: [],
	activeModule: null,
	activeLesson: null,
	dueCount: 0,
	environment: 'vscode',
	isGenerating: false,
	capabilities: {
		hasActiveEditor: false,
		hasWorkspaceFolder: false,
		hasPackageJson: false,
	},
	pulse: null,
	error: null,
	feedback: null,
};

type Listener = (state: ViewState) => void;

class Store {
	private state: ViewState = EMPTY_STATE;
	private listeners = new Set<Listener>();
	private rafId = 0;

	getState(): ViewState {
		return this.state;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Replace the host-driven slice. Preserves view-only fields like `feedback`. */
	hydrate(next: ViewState): void {
		const prevFeedback = this.state.feedback;
		const sameLesson =
			this.state.activeLesson?.lessonId === next.activeLesson?.lessonId &&
			this.state.activeLesson?.currentIndex === next.activeLesson?.currentIndex;
		this.state = {
			...next,
			feedback: sameLesson ? prevFeedback : null,
		};
		this.scheduleRender();
	}

	patch(partial: Partial<ViewState>): void {
		this.state = { ...this.state, ...partial };
		this.scheduleRender();
	}

	setScreen(screen: ViewState['screen']): void {
		this.patch({ screen });
	}

	setTrackOptimistic(track: Track): void {
		this.patch({ track });
	}

	setError(message: string | null): void {
		this.patch({ error: message });
	}

	setPulse(info: ViewState['pulse']): void {
		this.patch({ pulse: info });
	}

	setGenerating(isGenerating: boolean, topic?: Topic): void {
		this.patch({ isGenerating, generatingTopic: topic });
	}

	setFeedback(feedback: FeedbackUiState | null): void {
		this.patch({ feedback });
	}

	updateFeedback(updater: (f: FeedbackUiState) => FeedbackUiState): void {
		if (!this.state.feedback) {
			return;
		}
		this.patch({ feedback: updater(this.state.feedback) });
	}

	currentQuestion(): Question | null {
		const lesson = this.state.activeLesson;
		if (!lesson) {
			return null;
		}
		return lesson.questions[lesson.currentIndex] ?? null;
	}

	private scheduleRender(): void {
		if (this.rafId) {
			return;
		}
		this.rafId = requestAnimationFrame(() => {
			this.rafId = 0;
			for (const l of this.listeners) {
				try {
					l(this.state);
				} catch (err) {
					console.error('[VibeCheck webview] listener error', err);
				}
			}
		});
	}
}

export const store = new Store();
