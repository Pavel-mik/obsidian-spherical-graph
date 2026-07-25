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
	{
		files: ['src/settings/SphericalGraphSettingTab.ts'],
		rules: {
			// The declarative settings definitions are an Obsidian 1.13 API;
			// this plugin intentionally supports the declared 1.7.2 minimum.
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
);
