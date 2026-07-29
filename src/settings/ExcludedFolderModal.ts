import {
	App,
	ButtonComponent,
	Modal,
	TFolder,
} from 'obsidian';
import { normalizeExcludedFolderPrefixes } from './settings';

interface FolderEntry {
	readonly path: string;
	readonly depth: number;
}

function collectFolders(folder: TFolder, entries: FolderEntry[]): void {
	for (const child of folder.children) {
		if (!(child instanceof TFolder)) {
			continue;
		}
		entries.push({
			path: child.path,
			depth: child.path.split('/').length - 1,
		});
		collectFolders(child, entries);
	}
}

function collapseSelections(values: Iterable<string>): string[] {
	const ordered = normalizeExcludedFolderPrefixes([...values]).sort(
		(left, right) =>
			left.split('/').length - right.split('/').length ||
			left.localeCompare(right),
	);
	const retained: string[] = [];
	for (const path of ordered) {
		if (
			retained.some(
				(parent) => path === parent || path.startsWith(`${parent}/`),
			)
		) {
			continue;
		}
		retained.push(path);
	}
	return retained;
}

export class ExcludedFolderModal extends Modal {
	private readonly selected: Set<string>;
	private readonly folders: readonly FolderEntry[];

	constructor(
		app: App,
		initial: readonly string[],
		private readonly onApply: (paths: readonly string[]) => void,
	) {
		super(app);
		this.selected = new Set(normalizeExcludedFolderPrefixes(initial));
		const folders: FolderEntry[] = [];
		collectFolders(app.vault.getRoot(), folders);
		this.folders = folders.sort((left, right) =>
			left.path.localeCompare(right.path),
		);
	}

	onOpen(): void {
		this.setTitle('Choose excluded folders');
		this.contentEl.addClass('spherical-graph-folder-picker');
		this.contentEl.createEl('p', {
			text: 'Selected folders and all their descendants are omitted after the next refresh.',
			cls: 'spherical-graph-folder-picker-description',
		});
		const search = this.contentEl.createEl('input', {
			type: 'search',
			placeholder: 'Find a folder…',
			cls: 'spherical-graph-folder-picker-search',
			attr: { 'aria-label': 'Find a vault folder' },
		});
		const list = this.contentEl.createDiv({
			cls: 'spherical-graph-folder-picker-list',
		});
		const renderRows = (): void => {
			const query = search.value.trim().toLocaleLowerCase();
			list.empty();
			const visible = this.folders.filter((folder) =>
				folder.path.toLocaleLowerCase().includes(query),
			);
			if (visible.length === 0) {
				list.createDiv({
					text: 'No matching folders.',
					cls: 'spherical-graph-folder-picker-empty',
				});
				return;
			}
			for (const folder of visible) {
				const coveringSelection = [...this.selected].find(
					(selected) =>
						folder.path === selected ||
						folder.path.startsWith(`${selected}/`),
				);
				const row = list.createEl('label', {
					cls: 'spherical-graph-folder-picker-row',
				});
				row.style.setProperty(
					'--sg-folder-depth',
					String(folder.depth),
				);
				const checkbox = row.createEl('input', {
					type: 'checkbox',
					attr: {
						'aria-label': `Exclude ${folder.path}`,
					},
				});
				checkbox.checked = coveringSelection !== undefined;
				checkbox.disabled =
					coveringSelection !== undefined &&
					coveringSelection !== folder.path;
				if (checkbox.disabled) {
					row.addClass('is-covered-by-parent');
					row.title = `Already excluded by ${coveringSelection}`;
				}
				row.createSpan({ text: folder.path });
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						this.selected.add(folder.path);
						for (const selected of [...this.selected]) {
							if (selected.startsWith(`${folder.path}/`)) {
								this.selected.delete(selected);
							}
						}
					} else {
						this.selected.delete(folder.path);
					}
					renderRows();
				});
			}
		};
		search.addEventListener('input', renderRows);
		renderRows();

		const footer = this.contentEl.createDiv({
			cls: 'spherical-graph-folder-picker-footer',
		});
		new ButtonComponent(footer)
			.setButtonText('Cancel')
			.onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText('Apply')
			.setCta()
			.onClick(() => {
				this.onApply(collapseSelections(this.selected));
				this.close();
			});
		search.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
