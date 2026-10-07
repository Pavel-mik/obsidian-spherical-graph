import { App, Modal } from 'obsidian';

/** Use Obsidian's modal history so Android Back dismisses presentation first. */
export class MobilePresentationModal extends Modal {
	private readonly originalParent: Node | null;
	private readonly originalNextSibling: Node | null;
	private restored = false;

	constructor(app: App, private readonly root: HTMLElement, private readonly onExit: () => void) {
		super(app);
		this.originalParent = root.parentNode;
		this.originalNextSibling = root.nextSibling;
		this.shouldRestoreSelection = false;
		this.containerEl.classList.add('spherical-graph-presentation-modal');
	}

	override onOpen(): void {
		this.contentEl.append(this.root);
	}

	override onClose(): void {
		if (this.restored) return;
		this.restored = true;
		const next = this.originalNextSibling?.parentNode === this.originalParent
			? this.originalNextSibling : null;
		this.originalParent?.insertBefore(this.root, next);
		this.onExit();
	}
}
