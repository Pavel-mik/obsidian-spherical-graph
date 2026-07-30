export const AUTO_ROTATION_RADIANS_PER_SECOND = 0.07;
export const AUTO_ROTATION_RESUME_DELAY_MS = 3_000;
const MAXIMUM_FRAME_DELTA_MS = 64;

export function automaticRotationAngle(deltaMs: number): number {
	if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
		return 0;
	}
	return (
		(Math.min(MAXIMUM_FRAME_DELTA_MS, deltaMs) / 1000) *
		AUTO_ROTATION_RADIANS_PER_SECOND
	);
}

export interface AutoRotationScheduler {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface AutoRotationPauseControllerOptions {
	readonly onActiveChange: (active: boolean) => void;
	readonly scheduler?: AutoRotationScheduler;
	readonly resumeDelayMs?: number;
}

const DEFAULT_SCHEDULER: AutoRotationScheduler = {
	setTimeout: (callback, delayMs) =>
		window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => {
		window.clearTimeout(
			handle as ReturnType<typeof window.setTimeout>,
		);
	},
};

/**
 * Separates the user's persistent checkbox choice (`enabled`) from the
 * renderer's momentary rotation state (`active`). Camera manipulation pauses
 * rotation without unchecking the control, and the latest completed
 * interaction restarts a deterministic three-second grace period.
 */
export class AutoRotationPauseController {
	private enabledState = false;
	private activeState = false;
	private manipulating = false;
	private resumeTimer: unknown;
	private disposed = false;

	private readonly scheduler: AutoRotationScheduler;
	private readonly resumeDelayMs: number;
	private readonly onActiveChange: (active: boolean) => void;

	constructor(options: AutoRotationPauseControllerOptions) {
		this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
		this.resumeDelayMs =
			Number.isFinite(options.resumeDelayMs) &&
			(options.resumeDelayMs ?? -1) >= 0
				? (options.resumeDelayMs as number)
				: AUTO_ROTATION_RESUME_DELAY_MS;
		this.onActiveChange = options.onActiveChange;
	}

	get enabled(): boolean {
		return this.enabledState;
	}

	get active(): boolean {
		return this.activeState;
	}

	setEnabled(enabled: boolean): void {
		if (this.disposed || this.enabledState === enabled) {
			return;
		}
		this.enabledState = enabled;
		this.cancelResume();
		this.setActive(enabled && !this.manipulating);
	}

	beginUserInteraction(): void {
		if (this.disposed) {
			return;
		}
		this.manipulating = true;
		this.cancelResume();
		this.setActive(false);
	}

	/**
	 * Use for discrete camera changes that do not have matching start/end
	 * events (for example a wheel zoom). Repeated calls debounce the resume.
	 */
	noteUserInteraction(): void {
		if (this.disposed) {
			return;
		}
		this.setActive(false);
		if (!this.manipulating) {
			this.scheduleResume();
		}
	}

	endUserInteraction(): void {
		if (this.disposed) {
			return;
		}
		this.manipulating = false;
		this.setActive(false);
		this.scheduleResume();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancelResume();
		this.enabledState = false;
		this.setActive(false);
	}

	private scheduleResume(): void {
		this.cancelResume();
		if (!this.enabledState || this.manipulating) {
			return;
		}
		this.resumeTimer = this.scheduler.setTimeout(() => {
			this.resumeTimer = undefined;
			if (
				!this.disposed &&
				this.enabledState &&
				!this.manipulating
			) {
				this.setActive(true);
			}
		}, this.resumeDelayMs);
	}

	private cancelResume(): void {
		if (this.resumeTimer === undefined) {
			return;
		}
		this.scheduler.clearTimeout(this.resumeTimer);
		this.resumeTimer = undefined;
	}

	private setActive(active: boolean): void {
		if (this.activeState === active) {
			return;
		}
		this.activeState = active;
		this.onActiveChange(active);
	}
}
