import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'virtual:spherical-graph-worker': fileURLToPath(
				new URL(
					'./tests/fixtures/workerSource.ts',
					import.meta.url,
				),
			),
			'virtual:spherical-graph-data-worker': fileURLToPath(
				new URL('./tests/fixtures/workerSource.ts', import.meta.url),
			),
			'virtual:spherical-graph-land-worker': fileURLToPath(
				new URL('./tests/fixtures/workerSource.ts', import.meta.url),
			),
			'virtual:spherical-graph-geography-worker': fileURLToPath(
				new URL('./tests/fixtures/workerSource.ts', import.meta.url),
			),
		},
	},
	test: {
		environment: 'node',
		globals: false,
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/main.ts',
				'src/layout/workerSource.d.ts',
				'src/layout/worker-entry.ts',
			],
		},
	},
});
