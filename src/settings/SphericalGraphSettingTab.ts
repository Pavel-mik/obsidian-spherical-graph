import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TextComponent,
} from 'obsidian';
import {
	cloneSphericalGraphSettings,
	DEFAULT_SPHERICAL_GRAPH_SETTINGS,
	parseSphericalGraphSettings,
	SettingsChangeScope,
	SphericalGraphSettings,
	SurfaceMode,
} from './settings';
import {
	MAX_TAG_ORBIT_HEIGHT_PERCENT,
	MIN_TAG_ORBIT_HEIGHT_PERCENT,
} from '../constants';

export interface SphericalGraphSettingTabController {
	getSettings(): SphericalGraphSettings;
	updateSettings(
		settings: SphericalGraphSettings,
		scope: SettingsChangeScope,
	): Promise<void> | void;
}

const COPY = {
	dataHeading: 'Data',
	appearanceHeading: 'Appearance',
	advancedHeading: 'Advanced layout',
	refreshHeading: 'Refresh preservation',
	excludedFolders: 'Excluded folder prefixes',
	excludedFoldersDescription:
		'Comma- or line-separated vault-relative prefixes. Filter changes become pending and never start a calculation.',
	includeOrphans: 'Include orphan notes',
	includeOrphansDescription: 'Show Markdown notes with no resolved links.',
	debounce: 'Change detection debounce',
	debounceDescription: 'Delay before vault changes are grouped, in milliseconds.',
	pendingLimit: 'Pending detail limit',
	pendingLimitDescription:
		'Maximum number of changed items retained for a concise status summary.',
	globeSize: 'Globe size',
	globeSizeDescription:
		'Relative globe scale. Higher values make nodes and the selection frame smaller without moving the fixed layout.',
	tagOrbitHeight: 'Tag orbit height',
	tagOrbitHeightDescription:
		'Distance between tag satellites and the globe surface, as a percentage of the globe radius.',
	tagViewProtection: 'Protect globe view from tags',
	tagViewProtectionDescription:
		'Fade tag satellites and the outer ends of their links near the camera axis. Disabled by default.',
	sizeByDegree: 'Size nodes by degree',
	edgeOpacity: 'Edge opacity',
	showLabels: 'Show labels',
	maxLabels: 'Maximum labels',
	labelZoomThreshold: 'Label zoom-in threshold',
	labelZoomThresholdDescription:
		'Labels appear after this zoom level. 0% always shows them; 100% requires the closest zoom.',
	surfaceMode: 'Sphere surface',
	surfaceOpacity: 'Surface opacity',
	followTheme: 'Background follows theme',
	focusDuration: 'Focus animation duration',
	focusDurationDescription: 'Camera focus duration in milliseconds.',
	baseSeed: 'Deterministic base seed',
	springStrength: 'Spring strength',
	repulsionStrength: 'Repulsion strength',
	centroidStrength: 'Centroid coverage strength',
	isotropyStrength: 'Covariance isotropy strength',
	damping: 'Damping',
	initialStep: 'Initial step',
	maxVelocity: 'Maximum angular velocity',
	maxIterations: 'Maximum iterations',
	convergence: 'Convergence tolerance',
	exactThreshold: 'Exact repulsion threshold',
	negativeSamples: 'Negative samples per movable node',
	progressInterval: 'Progress report interval',
	progressIntervalDescription: 'Minimum time between reports, in milliseconds.',
	warmup: 'New-node warm-up iterations',
	hops: 'Affected neighborhood hops',
	anchor: 'Anchor strength',
	affectedMultiplier: 'Affected-node anchor multiplier',
	maxDisplacement: 'Maximum old-node displacement',
	maxDisplacementDescription: 'Geodesic displacement cap in degrees.',
	largeChange: 'Large-change warning ratio',
	restore: 'Restore defaults',
	restoreDescription:
		'Restore layout and refresh defaults. The committed map remains fixed until a later explicit layout operation.',
} as const;

interface NumberInputOptions {
	min: number;
	max: number;
	step: number;
}

export class SphericalGraphSettingTab extends PluginSettingTab {
	private readonly controller: SphericalGraphSettingTabController;

	constructor(
		app: App,
		plugin: Plugin,
		controller: SphericalGraphSettingTabController,
	) {
		super(app, plugin);
		this.controller = controller;
	}

	display(): void {
		this.containerEl.empty();

		const settings = cloneSphericalGraphSettings(
			this.controller.getSettings(),
		);
		this.renderDataSettings(settings);
		this.renderAppearanceSettings(settings);
		this.renderAdvancedSettings(settings);
	}

	private renderDataSettings(settings: SphericalGraphSettings): void {
		new Setting(this.containerEl)
			.setName(COPY.dataHeading)
			.setHeading();

		new Setting(this.containerEl)
			.setName(COPY.excludedFolders)
			.setDesc(COPY.excludedFoldersDescription)
			.addTextArea((text) => {
				text
					.setPlaceholder('Archive/\ntemplates/')
					.setValue(settings.data.excludedFolderPrefixes.join('\n'))
					.onChange((value) =>
						this.commit(settings, 'data', (next) => {
							next.data.excludedFolderPrefixes = value
								.split(/[,\n]/u)
								.map((prefix) => prefix.trim());
						}),
					);
				text.inputEl.rows = 3;
			});

		new Setting(this.containerEl)
			.setName(COPY.includeOrphans)
			.setDesc(COPY.includeOrphansDescription)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.data.includeOrphanNotes)
					.onChange((value) =>
						this.commit(settings, 'data', (next) => {
							next.data.includeOrphanNotes = value;
						}),
					),
			);

		this.addNumberSetting(
			this.containerEl,
			COPY.debounce,
			COPY.debounceDescription,
			settings.data.graphChangeDebounceMs,
			{ min: 100, max: 10_000, step: 50 },
			(value) =>
				this.commit(settings, 'data', (next) => {
					next.data.graphChangeDebounceMs = value;
				}),
		);

		this.addNumberSetting(
			this.containerEl,
			COPY.pendingLimit,
			COPY.pendingLimitDescription,
			settings.data.pendingDiffListLimit,
			{ min: 1, max: 500, step: 1 },
			(value) =>
				this.commit(settings, 'data', (next) => {
					next.data.pendingDiffListLimit = value;
				}),
		);
	}

	private renderAppearanceSettings(settings: SphericalGraphSettings): void {
		new Setting(this.containerEl)
			.setName(COPY.appearanceHeading)
			.setHeading();

		this.addNumberSetting(
			this.containerEl,
			COPY.globeSize,
			COPY.globeSizeDescription,
			settings.appearance.globeSize,
			{ min: 40, max: 400, step: 5 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.globeSize = value;
			}),
		);

		this.addNumberSetting(
			this.containerEl,
			COPY.tagOrbitHeight,
			COPY.tagOrbitHeightDescription,
			settings.appearance.tagOrbitHeightPercent,
			{
				min: MIN_TAG_ORBIT_HEIGHT_PERCENT,
				max: MAX_TAG_ORBIT_HEIGHT_PERCENT,
				step: 1,
			},
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.tagOrbitHeightPercent = value;
				}),
		);

		new Setting(this.containerEl)
			.setName(COPY.tagViewProtection)
			.setDesc(COPY.tagViewProtectionDescription)
			.addToggle((toggle) =>
				toggle
					.setValue(
						settings.appearance.tagViewProtectionEnabled,
					)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.tagViewProtectionEnabled = value;
						}),
					),
			);

		new Setting(this.containerEl)
			.setName(COPY.sizeByDegree)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.appearance.sizeNodesByDegree)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.sizeNodesByDegree = value;
						}),
					),
			);

		this.addNumberSetting(
			this.containerEl,
			COPY.edgeOpacity,
			undefined,
			settings.appearance.edgeOpacity,
			{ min: 0, max: 1, step: 0.01 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.edgeOpacity = value;
				}),
		);

		new Setting(this.containerEl)
			.setName(COPY.showLabels)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.appearance.showLabels)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.showLabels = value;
						}),
					),
			);

		this.addNumberSetting(
			this.containerEl,
			COPY.maxLabels,
			undefined,
			settings.appearance.maxLabels,
			{ min: 0, max: 200, step: 1 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.maxLabels = value;
				}),
		);

		this.addNumberSetting(
			this.containerEl,
			COPY.labelZoomThreshold,
			COPY.labelZoomThresholdDescription,
			settings.appearance.labelZoomThresholdPercent,
			{ min: 0, max: 100, step: 5 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.labelZoomThresholdPercent = value;
				}),
		);

		new Setting(this.containerEl)
			.setName(COPY.surfaceMode)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('solid', 'Solid')
					.addOption('transparent', 'Transparent')
					.addOption('hidden', 'Hidden')
					.setValue(settings.appearance.surfaceMode)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.surfaceMode = value as SurfaceMode;
						}),
					),
			);

		this.addNumberSetting(
			this.containerEl,
			COPY.surfaceOpacity,
			undefined,
			settings.appearance.surfaceOpacity,
			{ min: 0, max: 1, step: 0.01 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.surfaceOpacity = value;
				}),
		);

		new Setting(this.containerEl)
			.setName(COPY.followTheme)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.appearance.backgroundFollowsTheme)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.backgroundFollowsTheme = value;
						}),
					),
			);

		this.addNumberSetting(
			this.containerEl,
			COPY.focusDuration,
			COPY.focusDurationDescription,
			settings.appearance.focusAnimationDurationMs,
			{ min: 0, max: 5_000, step: 50 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.focusAnimationDurationMs = value;
				}),
		);
	}

	private renderAdvancedSettings(settings: SphericalGraphSettings): void {
		const details = this.containerEl.createEl('details', {
			cls: 'spherical-graph-settings-advanced',
		});
		details.createEl('summary', { text: COPY.advancedHeading });

		this.addNumberSetting(
			details,
			COPY.baseSeed,
			undefined,
			settings.layout.baseSeed,
			{ min: 0, max: 0xffff_ffff, step: 1 },
			(value) =>
				this.commit(settings, 'layout', (next) => {
					next.layout.baseSeed = value;
				}),
		);
		this.addLayoutNumberSettings(details, settings);
		new Setting(details).setName(COPY.refreshHeading).setHeading();
		this.addRefreshNumberSettings(details, settings);

		new Setting(details)
			.setName(COPY.restore)
			.setDesc(COPY.restoreDescription)
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(COPY.restore)
					.onClick(async () => {
						const defaults = DEFAULT_SPHERICAL_GRAPH_SETTINGS;
						const next = cloneSphericalGraphSettings(
							this.controller.getSettings(),
						);
						next.layout = { ...defaults.layout };
						next.refresh = { ...defaults.refresh };
						await this.controller.updateSettings(
							next,
							'layout',
						);
						this.display();
					}),
			);
	}

	private addLayoutNumberSettings(
		parent: HTMLElement,
		settings: SphericalGraphSettings,
	): void {
		const entries: Array<{
			name: string;
			description?: string;
			value: number;
			options: NumberInputOptions;
			set: (next: SphericalGraphSettings, value: number) => void;
		}> = [
			{
				name: COPY.springStrength,
				value: settings.layout.springStrength,
				options: { min: 0, max: 10, step: 0.001 },
				set: (next, value) => {
					next.layout.springStrength = value;
				},
			},
			{
				name: COPY.repulsionStrength,
				value: settings.layout.repulsionStrength,
				options: { min: 0, max: 10, step: 0.001 },
				set: (next, value) => {
					next.layout.repulsionStrength = value;
				},
			},
			{
				name: COPY.centroidStrength,
				value: settings.layout.centroidCoverageStrength,
				options: { min: 0, max: 10, step: 0.001 },
				set: (next, value) => {
					next.layout.centroidCoverageStrength = value;
				},
			},
			{
				name: COPY.isotropyStrength,
				value: settings.layout.isotropyStrength,
				options: { min: 0, max: 10, step: 0.001 },
				set: (next, value) => {
					next.layout.isotropyStrength = value;
				},
			},
			{
				name: COPY.damping,
				value: settings.layout.damping,
				options: { min: 0, max: 0.999, step: 0.001 },
				set: (next, value) => {
					next.layout.damping = value;
				},
			},
			{
				name: COPY.initialStep,
				value: settings.layout.initialStep,
				options: { min: 0.000_1, max: 1, step: 0.000_1 },
				set: (next, value) => {
					next.layout.initialStep = value;
				},
			},
			{
				name: COPY.maxVelocity,
				value: settings.layout.maxAngularVelocity,
				options: { min: 0.001, max: 1, step: 0.001 },
				set: (next, value) => {
					next.layout.maxAngularVelocity = value;
				},
			},
			{
				name: COPY.maxIterations,
				value: settings.layout.maxIterations,
				options: { min: 1, max: 100_000, step: 1 },
				set: (next, value) => {
					next.layout.maxIterations = value;
				},
			},
			{
				name: COPY.convergence,
				value: settings.layout.convergenceTolerance,
				options: { min: 1e-8, max: 0.1, step: 0.000_01 },
				set: (next, value) => {
					next.layout.convergenceTolerance = value;
				},
			},
			{
				name: COPY.exactThreshold,
				value: settings.layout.exactRepulsionThreshold,
				options: { min: 2, max: 5_000, step: 1 },
				set: (next, value) => {
					next.layout.exactRepulsionThreshold = value;
				},
			},
			{
				name: COPY.negativeSamples,
				value: settings.layout.negativeSamplesPerNode,
				options: { min: 1, max: 256, step: 1 },
				set: (next, value) => {
					next.layout.negativeSamplesPerNode = value;
				},
			},
			{
				name: COPY.progressInterval,
				description: COPY.progressIntervalDescription,
				value: settings.layout.progressReportIntervalMs,
				options: { min: 100, max: 5_000, step: 25 },
				set: (next, value) => {
					next.layout.progressReportIntervalMs = value;
				},
			},
		];
		for (const entry of entries) {
			this.addNumberSetting(
				parent,
				entry.name,
				entry.description,
				entry.value,
				entry.options,
				(value) =>
					this.commit(settings, 'layout', (next) =>
						entry.set(next, value),
					),
			);
		}
	}

	private addRefreshNumberSettings(
		parent: HTMLElement,
		settings: SphericalGraphSettings,
	): void {
		const entries = [
			{
				name: COPY.warmup,
				value: settings.refresh.newNodeWarmupIterations,
				options: { min: 0, max: 100_000, step: 1 },
				set: (next: SphericalGraphSettings, value: number) => {
					next.refresh.newNodeWarmupIterations = value;
				},
			},
			{
				name: COPY.hops,
				value: settings.refresh.affectedNeighborhoodHops,
				options: { min: 0, max: 10, step: 1 },
				set: (next: SphericalGraphSettings, value: number) => {
					next.refresh.affectedNeighborhoodHops = value;
				},
			},
			{
				name: COPY.anchor,
				value: settings.refresh.anchorStrength,
				options: { min: 0, max: 100, step: 0.01 },
				set: (next: SphericalGraphSettings, value: number) => {
					next.refresh.anchorStrength = value;
				},
			},
			{
				name: COPY.affectedMultiplier,
				value: settings.refresh.affectedNodeAnchorMultiplier,
				options: { min: 0, max: 1, step: 0.01 },
				set: (next: SphericalGraphSettings, value: number) => {
					next.refresh.affectedNodeAnchorMultiplier = value;
				},
			},
			{
				name: COPY.maxDisplacement,
				description: COPY.maxDisplacementDescription,
				value: settings.refresh.maxOldNodeDisplacementDegrees,
				options: { min: 0.1, max: 90, step: 0.1 },
				set: (next: SphericalGraphSettings, value: number) => {
					next.refresh.maxOldNodeDisplacementDegrees = value;
				},
			},
			{
				name: COPY.largeChange,
				value: settings.refresh.largeChangeWarningRatio,
				options: { min: 0, max: 1, step: 0.01 },
				set: (next: SphericalGraphSettings, value: number) => {
					next.refresh.largeChangeWarningRatio = value;
				},
			},
		];

		for (const entry of entries) {
			this.addNumberSetting(
				parent,
				entry.name,
				entry.description,
				entry.value,
				entry.options,
				(value) =>
					this.commit(settings, 'refresh', (next) =>
						entry.set(next, value),
					),
			);
		}
	}

	private addNumberSetting(
		parent: HTMLElement,
		name: string,
		description: string | undefined,
		value: number,
		options: NumberInputOptions,
		onChange: (value: number) => Promise<void>,
	): void {
		const setting = new Setting(parent).setName(name);
		if (description !== undefined) {
			setting.setDesc(description);
		}
		setting.addText((text) => {
			this.configureNumberInput(text, value, options);
			text.onChange(async (raw) => {
				const parsed = Number(raw);
				if (Number.isFinite(parsed)) {
					await onChange(parsed);
				}
			});
		});
	}

	private configureNumberInput(
		text: TextComponent,
		value: number,
		options: NumberInputOptions,
	): void {
		text.setValue(String(value));
		text.inputEl.type = 'number';
		text.inputEl.min = String(options.min);
		text.inputEl.max = String(options.max);
		text.inputEl.step = String(options.step);
	}

	private async commit(
		baseline: SphericalGraphSettings,
		scope: SettingsChangeScope,
		mutate: (settings: SphericalGraphSettings) => void,
	): Promise<void> {
		const current = this.controller.getSettings();
		const next = cloneSphericalGraphSettings(
			current === baseline ? baseline : current,
		);
		mutate(next);
		await this.controller.updateSettings(
			parseSphericalGraphSettings(next),
			scope,
		);
	}
}
