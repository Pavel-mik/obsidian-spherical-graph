import {
	existsSync,
	readFileSync,
	statSync,
} from 'node:fs';
import process from 'node:process';

const readJson = (path) =>
	JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');
const versions = readJson('versions.json');
const errors = [];

const requireNonEmptyString = (key) => {
	if (
		typeof manifest[key] !== 'string' ||
		manifest[key].trim().length === 0
	) {
		errors.push(`manifest.json: "${key}" must be a non-empty string.`);
	}
};

for (const key of [
	'id',
	'name',
	'version',
	'minAppVersion',
	'description',
	'author',
]) {
	requireNonEmptyString(key);
}

if (
	typeof manifest.id === 'string' &&
	(
		!/^[a-z]+(?:-[a-z]+)*$/u.test(manifest.id) ||
		manifest.id.includes('obsidian') ||
		manifest.id.endsWith('plugin')
	)
) {
	errors.push(
		'manifest.json: "id" must use lowercase letters and hyphens, and cannot contain "obsidian" or end with "plugin".',
	);
}

if (
	typeof manifest.name === 'string' &&
	(
		!/^[\x20-\x7E]+$/u.test(manifest.name) ||
		/\b(?:obsidian|plugin)\b/iu.test(manifest.name)
	)
) {
	errors.push(
		'manifest.json: "name" must use Basic Latin and cannot contain "Obsidian" or "Plugin".',
	);
}

const semanticVersion = /^\d+\.\d+\.\d+$/u;
if (
	typeof manifest.version === 'string' &&
	!semanticVersion.test(manifest.version)
) {
	errors.push(
		'manifest.json: "version" must use the x.y.z format.',
	);
}
if (
	typeof manifest.minAppVersion === 'string' &&
	!semanticVersion.test(manifest.minAppVersion)
) {
	errors.push(
		'manifest.json: "minAppVersion" must use the x.y.z format.',
	);
}

if (manifest.version !== packageJson.version) {
	errors.push(
		'manifest.json and package.json must use the same version.',
	);
}
if (versions[manifest.version] !== manifest.minAppVersion) {
	errors.push(
		'versions.json must map the current plugin version to minAppVersion.',
	);
}
if (manifest.isDesktopOnly !== true) {
	errors.push(
		'manifest.json: this desktop-only WebGL plugin must set "isDesktopOnly" to true.',
	);
}
if (
	typeof manifest.description === 'string' &&
	(
		manifest.description.length > 250 ||
		!manifest.description.endsWith('.')
	)
) {
	errors.push(
		'manifest.json: "description" must be at most 250 characters and end with a period.',
	);
}

for (const path of [
	'README.md',
	'LICENSE',
	'main.js',
	'manifest.json',
	'styles.css',
]) {
	if (!existsSync(path) || statSync(path).size === 0) {
		errors.push(`${path} must exist and be non-empty.`);
	}
}

if (
	existsSync('main.js') &&
	readFileSync('main.js', 'utf8').includes('sourceMappingURL=')
) {
	errors.push('main.js must not contain an inline or external source map.');
}

const releaseTag = process.env.RELEASE_TAG;
if (
	releaseTag !== undefined &&
	releaseTag.length > 0 &&
	releaseTag !== manifest.version
) {
	errors.push(
		`Release tag "${releaseTag}" must match manifest version "${manifest.version}".`,
	);
}

if (errors.length > 0) {
	for (const error of errors) {
		process.stderr.write(`- ${error}\n`);
	}
	process.exitCode = 1;
} else {
	process.stdout.write(
		`Release ${manifest.version} is internally consistent.\n`,
	);
}
