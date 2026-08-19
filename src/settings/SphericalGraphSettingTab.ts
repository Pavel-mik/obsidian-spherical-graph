import {
	App,
	type ButtonComponent,
	Plugin,
	PluginSettingTab,
	Setting,
	type SettingDefinition,
	type SettingDefinitionItem,
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
	MAX_ATMOSPHERE_HEIGHT_PERCENT,
	MAX_TAG_ORBIT_HEIGHT_PERCENT,
	MIN_ATMOSPHERE_HEIGHT_PERCENT,
	MIN_TAG_ORBIT_HEIGHT_PERCENT,
} from '../constants';
import { ExcludedFolderModal } from './ExcludedFolderModal';

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
	phoneRenderQuality: 'Phone render quality',
	phoneRenderQualityDescription:
		'Automatic is recommended. Changes apply when the graph view is reopened.',
	tabletRenderQuality: 'Tablet render quality',
	tabletRenderQualityDescription:
		'Balance presentation quality and battery use. Changes apply when the graph view is reopened.',
	advancedHeading: 'Advanced layout',
	refreshHeading: 'Refresh preservation',
	excludedFolders: 'Excluded folders',
	excludedFoldersDescription:
		'Choose vault folders to omit with all descendants. Filter changes become pending and never start a calculation.',
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
	edgeZoomThreshold: 'Edge zoom-in threshold',
	edgeZoomThresholdDescription:
		'Links appear at this zoom level. 0% always shows them; 100% requires the closest zoom.',
	showLabels: 'Show labels',
	maxLabels: 'Maximum labels',
	labelZoomThreshold: 'Label zoom-in threshold',
	labelZoomThresholdDescription:
		'Labels appear after this zoom level. 0% always shows them; 100% requires the closest zoom.',
	showContinents: 'Show continents',
	showContinentsDescription:
		'Render folder-owned land, coastlines, root-note islands, and map labels. This never moves the fixed layout.',
	showAtmosphere: 'Show atmosphere',
	showAtmosphereDescription:
		'Render the subtle rotating cloud layer when the graph is viewed from farther away.',
	atmosphereHeight: 'Atmosphere height',
	atmosphereHeightDescription:
		'Distance between the atmosphere and the globe surface, as a percentage of the globe radius.',
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

	/**
	 * Obsidian 1.13+ renders and indexes these definitions for settings search.
	 * The imperative display() implementation remains below as the supported
	 * fallback for older Obsidian releases.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: COPY.dataHeading,
				items: [
					this.excludedFoldersDefinition(),
					this.numberDefinition(
						COPY.debounce,
						COPY.debounceDescription,
						'data.graphChangeDebounceMs',
						{ min: 100, max: 10_000, step: 50 },
						DEFAULT_SPHERICAL_GRAPH_SETTINGS.data
							.graphChangeDebounceMs,
					),
					this.numberDefinition(
						COPY.pendingLimit,
						COPY.pendingLimitDescription,
						'data.pendingDiffListLimit',
						{ min: 1, max: 500, step: 1 },
						DEFAULT_SPHERICAL_GRAPH_SETTINGS.data
							.pendingDiffListLimit,
					),
				],
			},
			{
				type: 'group',
				heading: COPY.appearanceHeading,
				items: this.appearanceDefinitions(),
			},
			{
				type: 'page',
				name: COPY.advancedHeading,
				desc: 'Fine-tune deterministic layout and refresh preservation.',
				items: [
					{
						type: 'group',
						heading: COPY.advancedHeading,
						items: this.layoutDefinitions(),
					},
					{
						type: 'group',
						heading: COPY.refreshHeading,
						items: this.refreshDefinitions(),
					},
					{
						type: 'group',
						heading: 'Defaults',
						items: [this.restoreDefinition()],
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		const target = this.resolveSettingKey(key);
		if (target === undefined) {
			return undefined;
		}
		const settings = this.controller.getSettings();
		const values = settings[target.scope] as unknown as Record<
			string,
			unknown
		>;
		return values[target.property];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const target = this.resolveSettingKey(key);
		if (target === undefined) {
			throw new Error(`Unknown Spherical Graph setting: ${key}`);
		}
		const next = cloneSphericalGraphSettings(
			this.controller.getSettings(),
		);
		const values = next[target.scope] as unknown as Record<
			string,
			unknown
		>;
		if (!Object.prototype.hasOwnProperty.call(values, target.property)) {
			throw new Error(`Unknown Spherical Graph setting: ${key}`);
		}
		values[target.property] = value;
		await this.controller.updateSettings(
			parseSphericalGraphSettings(next),
			target.scope,
		);
	}

	private appearanceDefinitions(): SettingDefinition[] {
		const defaults = DEFAULT_SPHERICAL_GRAPH_SETTINGS.appearance;
		return [
			{
				name: COPY.phoneRenderQuality,
				desc: COPY.phoneRenderQualityDescription,
				control: {
					type: 'dropdown',
					key: 'appearance.phoneRenderQuality',
					defaultValue: defaults.phoneRenderQuality,
					options: {
						automatic: 'Automatic',
						'battery-saver': 'Battery saver',
						'high-quality': 'High quality',
					},
				},
			},
			{
				name: COPY.tabletRenderQuality,
				desc: COPY.tabletRenderQualityDescription,
				control: {
					type: 'dropdown',
					key: 'appearance.tabletRenderQuality',
					defaultValue: defaults.tabletRenderQuality,
					options: {
						automatic: 'Automatic',
						'battery-saver': 'Battery saver',
						'high-quality': 'High quality',
					},
				},
			},
			this.numberDefinition(
				COPY.globeSize,
				COPY.globeSizeDescription,
				'appearance.globeSize',
				{ min: 40, max: 400, step: 5 },
				defaults.globeSize,
			),
			this.numberDefinition(
				COPY.tagOrbitHeight,
				COPY.tagOrbitHeightDescription,
				'appearance.tagOrbitHeightPercent',
				{
					min: MIN_TAG_ORBIT_HEIGHT_PERCENT,
					max: MAX_TAG_ORBIT_HEIGHT_PERCENT,
					step: 1,
				},
				defaults.tagOrbitHeightPercent,
			),
			this.toggleDefinition(
				COPY.showContinents,
				COPY.showContinentsDescription,
				'appearance.showContinents',
				defaults.showContinents,
			),
			this.toggleDefinition(
				COPY.showAtmosphere,
				COPY.showAtmosphereDescription,
				'appearance.showAtmosphere',
				defaults.showAtmosphere,
			),
			this.numberDefinition(
				COPY.atmosphereHeight,
				COPY.atmosphereHeightDescription,
				'appearance.atmosphereHeightPercent',
				{
					min: MIN_ATMOSPHERE_HEIGHT_PERCENT,
					max: MAX_ATMOSPHERE_HEIGHT_PERCENT,
					step: 1,
				},
				defaults.atmosphereHeightPercent,
			),
			this.toggleDefinition(
				COPY.tagViewProtection,
				COPY.tagViewProtectionDescription,
				'appearance.tagViewProtectionEnabled',
				defaults.tagViewProtectionEnabled,
			),
			this.toggleDefinition(
				COPY.sizeByDegree,
				undefined,
				'appearance.sizeNodesByDegree',
				defaults.sizeNodesByDegree,
			),
			this.numberDefinition(
				COPY.edgeOpacity,
				undefined,
				'appearance.edgeOpacity',
				{ min: 0, max: 1, step: 0.01 },
				defaults.edgeOpacity,
			),
			this.numberDefinition(
				COPY.edgeZoomThreshold,
				COPY.edgeZoomThresholdDescription,
				'appearance.edgeZoomThresholdPercent',
				{ min: 0, max: 100, step: 5 },
				defaults.edgeZoomThresholdPercent,
			),
			this.toggleDefinition(
				COPY.showLabels,
				undefined,
				'appearance.showLabels',
				defaults.showLabels,
			),
			this.numberDefinition(
				COPY.maxLabels,
				undefined,
				'appearance.maxLabels',
				{ min: 0, max: 200, step: 1 },
				defaults.maxLabels,
			),
			this.numberDefinition(
				COPY.labelZoomThreshold,
				COPY.labelZoomThresholdDescription,
				'appearance.labelZoomThresholdPercent',
				{ min: 0, max: 100, step: 5 },
				defaults.labelZoomThresholdPercent,
			),
			{
				name: COPY.surfaceMode,
				control: {
					type: 'dropdown',
					key: 'appearance.surfaceMode',
					defaultValue: defaults.surfaceMode,
					options: {
						solid: 'Solid',
						transparent: 'Transparent',
						hidden: 'Hidden',
					},
				},
			},
			this.numberDefinition(
				COPY.surfaceOpacity,
				undefined,
				'appearance.surfaceOpacity',
				{ min: 0, max: 1, step: 0.01 },
				defaults.surfaceOpacity,
			),
			this.toggleDefinition(
				COPY.followTheme,
				undefined,
				'appearance.backgroundFollowsTheme',
				defaults.backgroundFollowsTheme,
			),
			this.numberDefinition(
				COPY.focusDuration,
				COPY.focusDurationDescription,
				'appearance.focusAnimationDurationMs',
				{ min: 0, max: 5_000, step: 50 },
				defaults.focusAnimationDurationMs,
			),
		];
	}

	private layoutDefinitions(): SettingDefinition[] {
		const defaults = DEFAULT_SPHERICAL_GRAPH_SETTINGS.layout;
		return [
			this.numberDefinition(COPY.baseSeed, undefined, 'layout.baseSeed', { min: 0, max: 0xffff_ffff, step: 1 }, defaults.baseSeed),
			this.numberDefinition(COPY.springStrength, undefined, 'layout.springStrength', { min: 0, max: 10, step: 0.001 }, defaults.springStrength),
			this.numberDefinition(COPY.repulsionStrength, undefined, 'layout.repulsionStrength', { min: 0, max: 10, step: 0.001 }, defaults.repulsionStrength),
			this.numberDefinition(COPY.centroidStrength, undefined, 'layout.centroidCoverageStrength', { min: 0, max: 10, step: 0.001 }, defaults.centroidCoverageStrength),
			this.numberDefinition(COPY.isotropyStrength, undefined, 'layout.isotropyStrength', { min: 0, max: 10, step: 0.001 }, defaults.isotropyStrength),
			this.numberDefinition(COPY.damping, undefined, 'layout.damping', { min: 0, max: 0.999, step: 0.001 }, defaults.damping),
			this.numberDefinition(COPY.initialStep, undefined, 'layout.initialStep', { min: 0.000_1, max: 1, step: 0.000_1 }, defaults.initialStep),
			this.numberDefinition(COPY.maxVelocity, undefined, 'layout.maxAngularVelocity', { min: 0.001, max: 1, step: 0.001 }, defaults.maxAngularVelocity),
			this.numberDefinition(COPY.maxIterations, undefined, 'layout.maxIterations', { min: 1, max: 100_000, step: 1 }, defaults.maxIterations),
			this.numberDefinition(COPY.convergence, undefined, 'layout.convergenceTolerance', { min: 1e-8, max: 0.1, step: 0.000_01 }, defaults.convergenceTolerance),
			this.numberDefinition(COPY.exactThreshold, undefined, 'layout.exactRepulsionThreshold', { min: 2, max: 5_000, step: 1 }, defaults.exactRepulsionThreshold),
			this.numberDefinition(COPY.negativeSamples, undefined, 'layout.negativeSamplesPerNode', { min: 1, max: 256, step: 1 }, defaults.negativeSamplesPerNode),
			this.numberDefinition(COPY.progressInterval, COPY.progressIntervalDescription, 'layout.progressReportIntervalMs', { min: 100, max: 5_000, step: 25 }, defaults.progressReportIntervalMs),
		];
	}

	private refreshDefinitions(): SettingDefinition[] {
		const defaults = DEFAULT_SPHERICAL_GRAPH_SETTINGS.refresh;
		return [
			this.numberDefinition(COPY.warmup, undefined, 'refresh.newNodeWarmupIterations', { min: 0, max: 100_000, step: 1 }, defaults.newNodeWarmupIterations),
			this.numberDefinition(COPY.hops, undefined, 'refresh.affectedNeighborhoodHops', { min: 0, max: 10, step: 1 }, defaults.affectedNeighborhoodHops),
			this.numberDefinition(COPY.anchor, undefined, 'refresh.anchorStrength', { min: 0, max: 100, step: 0.01 }, defaults.anchorStrength),
			this.numberDefinition(COPY.affectedMultiplier, undefined, 'refresh.affectedNodeAnchorMultiplier', { min: 0, max: 1, step: 0.01 }, defaults.affectedNodeAnchorMultiplier),
			this.numberDefinition(COPY.maxDisplacement, COPY.maxDisplacementDescription, 'refresh.maxOldNodeDisplacementDegrees', { min: 0.1, max: 90, step: 0.1 }, defaults.maxOldNodeDisplacementDegrees),
			this.numberDefinition(COPY.largeChange, undefined, 'refresh.largeChangeWarningRatio', { min: 0, max: 1, step: 0.01 }, defaults.largeChangeWarningRatio),
		];
	}

	private numberDefinition(
		name: string,
		desc: string | undefined,
		key: string,
		options: NumberInputOptions,
		defaultValue: number,
	): SettingDefinition {
		return {
			name,
			desc,
			control: {
				type: 'number',
				key,
				defaultValue,
				...options,
			},
		};
	}

	private toggleDefinition(
		name: string,
		desc: string | undefined,
		key: string,
		defaultValue: boolean,
	): SettingDefinition {
		return {
			name,
			desc,
			control: { type: 'toggle', key, defaultValue },
		};
	}

	private excludedFoldersDefinition(): SettingDefinition {
		return {
			name: COPY.excludedFolders,
			desc: COPY.excludedFoldersDescription,
			aliases: ['Ignored folders', 'Excluded directories'],
			render: (setting) => {
				this.renderExcludedFoldersControl(setting, () =>
					this.refreshSettingsTab(),
				);
			},
		};
	}

	private restoreDefinition(): SettingDefinition {
		return {
			name: COPY.restore,
			desc: COPY.restoreDescription,
			render: (setting) => {
				setting.addButton((button) =>
					this.setDestructiveButton(button)
						.setButtonText(COPY.restore)
						.onClick(async () => {
							const defaults = DEFAULT_SPHERICAL_GRAPH_SETTINGS;
							const next = cloneSphericalGraphSettings(
								this.controller.getSettings(),
							);
							next.layout = { ...defaults.layout };
							next.refresh = { ...defaults.refresh };
							await this.controller.updateSettings(next, 'layout');
							this.refreshSettingsTab();
						}),
				);
			},
		};
	}

	private renderExcludedFoldersControl(
		setting: Setting,
		onUpdated: () => void,
	): void {
		const paths = [
			...this.controller.getSettings().data.excludedFolderPrefixes,
		];
		setting.addButton((button) => {
			button
				.setButtonText('Choose folders')
				.setTooltip('Choose excluded vault folders')
				.onClick(() => {
					new ExcludedFolderModal(this.app, paths, (nextPaths) => {
						void this.updateExcludedFolders(nextPaths).then(onUpdated);
					}).open();
				});
		});
		const chips = setting.settingEl.createDiv({
			cls: 'spherical-graph-folder-chips',
		});
		if (paths.length === 0) {
			chips.createSpan({
				text: 'None selected',
				cls: 'spherical-graph-folder-chip-empty',
			});
		}
		for (const path of paths) {
			const chip = chips.createSpan({
				cls: 'spherical-graph-folder-chip',
			});
			chip.createSpan({ text: path });
			const remove = chip.createEl('button', {
				text: '×',
				attr: {
					type: 'button',
					'aria-label': `Include ${path} again`,
					title: `Include ${path} again`,
				},
			});
			remove.addEventListener('click', () => {
				void this.updateExcludedFolders(
					paths.filter((entry) => entry !== path),
				).then(onUpdated);
			});
		}
	}

	private async updateExcludedFolders(
		paths: readonly string[],
	): Promise<void> {
		const next = cloneSphericalGraphSettings(
			this.controller.getSettings(),
		);
		next.data.excludedFolderPrefixes = [...paths];
		await this.controller.updateSettings(next, 'data');
	}

	private resolveSettingKey(
		key: string,
	): { scope: SettingsChangeScope; property: string } | undefined {
		const [scope, property, extra] = key.split('.');
		if (
			extra !== undefined ||
			property === undefined ||
			(scope !== 'appearance' &&
				scope !== 'data' &&
				scope !== 'layout' &&
				scope !== 'refresh')
		) {
			return undefined;
		}
		return { scope, property };
	}

	private refreshSettingsTab(): void {
		const compatibleTab = this as unknown as {
			update?: () => void;
			display: () => void;
		};
		if (typeof compatibleTab.update === 'function') {
			compatibleTab.update();
			return;
		}
		compatibleTab.display();
	}

	private setDestructiveButton(
		button: ButtonComponent,
	): ButtonComponent {
		const compatibleButton = button as unknown as {
			setDestructive?: () => ButtonComponent;
			setWarning: () => ButtonComponent;
		};
		return compatibleButton.setDestructive?.() ?? compatibleButton.setWarning();
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

		const excludedSetting = new Setting(this.containerEl)
			.setName(COPY.excludedFolders)
			.setDesc(COPY.excludedFoldersDescription)
			.addButton((button) => {
				button
					.setButtonText('Choose folders')
					.setTooltip('Choose excluded vault folders')
					.onClick(() => {
						new ExcludedFolderModal(
							this.app,
							settings.data.excludedFolderPrefixes,
							(paths) => {
								void this.commit(
									settings,
									'data',
									(next) => {
										next.data.excludedFolderPrefixes = [...paths];
									},
								).then(() => this.refreshSettingsTab());
							},
						).open();
					});
			});
		const chips = excludedSetting.settingEl.createDiv({
			cls: 'spherical-graph-folder-chips',
		});
		if (settings.data.excludedFolderPrefixes.length === 0) {
			chips.createSpan({
				text: 'None selected',
				cls: 'spherical-graph-folder-chip-empty',
			});
		}
		for (const path of settings.data.excludedFolderPrefixes) {
			const chip = chips.createSpan({
				cls: 'spherical-graph-folder-chip',
			});
			chip.createSpan({ text: path });
			const remove = chip.createEl('button', {
				text: '×',
				attr: {
					type: 'button',
					'aria-label': `Include ${path} again`,
					title: `Include ${path} again`,
				},
			});
			remove.addEventListener('click', () => {
				void this.commit(settings, 'data', (next) => {
					next.data.excludedFolderPrefixes =
						next.data.excludedFolderPrefixes.filter(
							(entry) => entry !== path,
						);
				}).then(() => this.refreshSettingsTab());
			});
		}

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

		new Setting(this.containerEl)
			.setName(COPY.phoneRenderQuality)
			.setDesc(COPY.phoneRenderQualityDescription)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('automatic', 'Automatic')
					.addOption('battery-saver', 'Battery saver')
					.addOption('high-quality', 'High quality')
					.setValue(settings.appearance.phoneRenderQuality)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.phoneRenderQuality =
								value === 'battery-saver' || value === 'high-quality'
									? value
									: 'automatic';
						}),
					),
			);

		new Setting(this.containerEl)
			.setName(COPY.tabletRenderQuality)
			.setDesc(COPY.tabletRenderQualityDescription)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('automatic', 'Automatic')
					.addOption('battery-saver', 'Battery saver')
					.addOption('high-quality', 'High quality')
					.setValue(settings.appearance.tabletRenderQuality)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.tabletRenderQuality =
								value === 'battery-saver' || value === 'high-quality'
									? value
									: 'automatic';
						}),
					),
			);

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
			.setName(COPY.showContinents)
			.setDesc(COPY.showContinentsDescription)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.appearance.showContinents)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.showContinents = value;
						}),
					),
			);

		new Setting(this.containerEl)
			.setName(COPY.showAtmosphere)
			.setDesc(COPY.showAtmosphereDescription)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.appearance.showAtmosphere)
					.onChange((value) =>
						this.commit(settings, 'appearance', (next) => {
							next.appearance.showAtmosphere = value;
						}),
					),
			);

		this.addNumberSetting(
			this.containerEl,
			COPY.atmosphereHeight,
			COPY.atmosphereHeightDescription,
			settings.appearance.atmosphereHeightPercent,
			{
				min: MIN_ATMOSPHERE_HEIGHT_PERCENT,
				max: MAX_ATMOSPHERE_HEIGHT_PERCENT,
				step: 1,
			},
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.atmosphereHeightPercent = value;
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

		this.addNumberSetting(
			this.containerEl,
			COPY.edgeZoomThreshold,
			COPY.edgeZoomThresholdDescription,
			settings.appearance.edgeZoomThresholdPercent,
			{ min: 0, max: 100, step: 5 },
			(value) =>
				this.commit(settings, 'appearance', (next) => {
					next.appearance.edgeZoomThresholdPercent = value;
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
				this.setDestructiveButton(button)
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
						this.refreshSettingsTab();
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
