import type { GraphDescriptor } from './graphTypes';
import type { GraphRenameHint } from './graphDiff';

interface RenameEvent {
	readonly oldPath: string;
	readonly newPath: string;
	readonly scope: 'file' | 'folder';
}

/** Keeps reliable identity changes until the current graph has been committed. */
export class RenameJournal {
	private events: RenameEvent[] = [];

	record(oldPath: string, newPath: string, scope: RenameEvent['scope']): void {
		if (oldPath !== newPath) {
			this.events.push({ oldPath, newPath, scope });
		}
	}

	hintsFor(descriptor: GraphDescriptor | undefined): GraphRenameHint[] {
		return (descriptor?.nodeIds ?? []).flatMap((original) => {
			let path = original;
			for (const event of this.events) {
				if (event.scope === 'file' && path === event.oldPath) {
					path = event.newPath;
				} else if (event.scope === 'folder' && path.startsWith(`${event.oldPath}/`)) {
					path = event.newPath + path.slice(event.oldPath.length);
				}
			}
			return path === original ? [] : [{
				oldPath: original,
				newPath: path,
				reliability: 'reliable' as const,
				source: 'vault-event' as const,
			}];
		});
	}

	clear(): void {
		this.events = [];
	}
}
