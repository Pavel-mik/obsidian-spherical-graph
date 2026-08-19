import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function projectFile(relativePath: string): string {
	return readFileSync(
		fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
		'utf8',
	);
}

describe('Obsidian Scorecard compatibility', () => {
	it('avoids CSS features rejected by the supported Obsidian baseline', () => {
		const css = projectFile('styles.css');

		expect(css).not.toMatch(/\bclip-path\s*:/u);
		expect(css).not.toMatch(/!important\b/u);
		expect(css).not.toMatch(/:has\s*\(/u);
	});

	it('exposes declarative settings definitions for Obsidian 1.13+', () => {
		const source = projectFile(
			'src/settings/SphericalGraphSettingTab.ts',
		);

		expect(source).toMatch(/getSettingDefinitions\(\)/u);
		expect(source).toContain('SettingDefinitionItem[]');
	});
});
