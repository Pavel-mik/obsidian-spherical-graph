import { describe, expect, it } from 'vitest';
import {
	AUTO_ROTATION_RESUME_DELAY_MS,
	AUTO_ROTATION_RADIANS_PER_SECOND,
	type AutoRotationScheduler,
	AutoRotationPauseController,
	automaticRotationAngle,
} from '../../src/render/autoRotation';

class TestScheduler implements AutoRotationScheduler {
	private nextHandle = 0;
	private readonly callbacks = new Map<number, () => void>();
	readonly delays: number[] = [];

	setTimeout(callback: () => void, delayMs: number): unknown {
		const handle = ++this.nextHandle;
		this.callbacks.set(handle, callback);
		this.delays.push(delayMs);
		return handle;
	}

	clearTimeout(handle: unknown): void {
		this.callbacks.delete(handle as number);
	}

	run(handle = this.nextHandle): void {
		const callback = this.callbacks.get(handle);
		this.callbacks.delete(handle);
		callback?.();
	}

	get pendingCount(): number {
		return this.callbacks.size;
	}
}

describe('automatic globe rotation', () => {
	it('advances at a slow deterministic speed', () => {
		expect(automaticRotationAngle(16)).toBeCloseTo(
			AUTO_ROTATION_RADIANS_PER_SECOND * 0.016,
			10,
		);
	});

	it('ignores invalid time and caps background-tab jumps', () => {
		expect(automaticRotationAngle(0)).toBe(0);
		expect(automaticRotationAngle(Number.NaN)).toBe(0);
		expect(automaticRotationAngle(10_000)).toBeCloseTo(
			AUTO_ROTATION_RADIANS_PER_SECOND * 0.064,
			10,
		);
	});

	it('keeps the checkbox enabled while interaction pauses rotation', () => {
		const scheduler = new TestScheduler();
		const transitions: boolean[] = [];
		const controller = new AutoRotationPauseController({
			scheduler,
			onActiveChange: (active) => transitions.push(active),
		});

		controller.setEnabled(true);
		controller.beginUserInteraction();
		controller.endUserInteraction();

		expect(controller.enabled).toBe(true);
		expect(controller.active).toBe(false);
		expect(scheduler.delays).toEqual([
			AUTO_ROTATION_RESUME_DELAY_MS,
		]);

		scheduler.run();
		expect(controller.active).toBe(true);
		expect(transitions).toEqual([true, false, true]);
	});

	it('debounces discrete adjustments and cancellation deterministically', () => {
		const scheduler = new TestScheduler();
		const transitions: boolean[] = [];
		const controller = new AutoRotationPauseController({
			scheduler,
			onActiveChange: (active) => transitions.push(active),
		});

		controller.setEnabled(true);
		controller.noteUserInteraction();
		controller.noteUserInteraction();

		expect(scheduler.pendingCount).toBe(1);
		scheduler.run(1);
		expect(controller.active).toBe(false);
		scheduler.run(2);
		expect(controller.active).toBe(true);

		controller.noteUserInteraction();
		controller.setEnabled(false);
		expect(controller.enabled).toBe(false);
		expect(scheduler.pendingCount).toBe(0);
		expect(transitions).toEqual([true, false, true, false]);
	});
});
