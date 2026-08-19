import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'scripts/*.mjs',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['scripts/**/*.{js,mjs,ts}', 'tests/**/*.ts', 'vitest.config.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			// Build tools and tests run under Node and are not included in main.js.
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	{
		files: [
			'scripts/generate-test-vault.mjs',
			'tests/scripts/generateTestVault.test.ts',
		],
		rules: {
			// The standalone generator deliberately guards the conventional
			// config directory and has no Vault instance/configDir available.
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
);
