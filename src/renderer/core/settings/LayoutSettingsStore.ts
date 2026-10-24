// Names every user-adjustable layout dimension persisted across application restarts.
export type LayoutDimension =
	"leftPaneWidth"
	| "editorPaneWidth"
	| "signalNavigationWidth"
	| "lookupHeight"
	| "dreamSourceHeight"
	| "dreamReflectionsHeight"
	| "dreamSynopticViewHeight"
	| "ideaSeeingHeight"
	| "chatComposerHeight";

// Persisted renderer layout preferences.
interface LayoutPreferences
{
	dimensions: Partial<Record<LayoutDimension, number>>;
	explorerCollapsed: boolean;
}

// Owns durable user-adjusted renderer dimensions and collapse state.
export class LayoutSettingsStore
{
	// Local storage key for the complete layout preference record.
	private static readonly StorageKey = "chora:layout-settings";
	// Lowest accepted persisted dimension prevents unusable restored surfaces.
	private static readonly MinimumDimension = 40;
	// Highest accepted persisted dimension rejects corrupt or unsupported values.
	private static readonly MaximumDimension = 4000;
	// Current preferences loaded once for consistent updates.
	private readonly preferences: LayoutPreferences = this.Load();

	// Returns a persisted dimension, or the supplied default when none is stored.
	public GetDimension(name: LayoutDimension, defaultValue: number): number
	{
		const stored = this.preferences.dimensions[name];
		const dimension = typeof stored === "number" ? stored : defaultValue;

		return dimension;
	}

	// Persists one bounded user-adjusted dimension.
	public SetDimension(name: LayoutDimension, value: number): void
	{
		if (Number.isFinite(value))
		{
			const bounded = Math.max(LayoutSettingsStore.MinimumDimension, Math.min(LayoutSettingsStore.MaximumDimension, value));
			this.preferences.dimensions[name] = Math.round(bounded);
			this.Save();
		}
	}

	// Returns whether the Explorer was collapsed by the reader.
	public GetExplorerCollapsed(): boolean
	{
		return this.preferences.explorerCollapsed;
	}

	// Persists the reader's Explorer collapse choice.
	public SetExplorerCollapsed(collapsed: boolean): void
	{
		this.preferences.explorerCollapsed = collapsed;
		this.Save();
	}

	// Reads valid persisted layout preferences while discarding corrupt fields.
	private Load(): LayoutPreferences
	{
		const preferences: LayoutPreferences = { dimensions: {}, explorerCollapsed: false };

		try
		{
			const stored = window.localStorage.getItem(LayoutSettingsStore.StorageKey);
			if (stored !== null)
			{
				const candidate = JSON.parse(stored) as Partial<LayoutPreferences>;
				if (candidate.explorerCollapsed === true) preferences.explorerCollapsed = true;
				if (typeof candidate.dimensions === "object" && candidate.dimensions !== null)
				{
					for (const [name, value] of Object.entries(candidate.dimensions))
					{
						if (this.IsDimensionName(name) && typeof value === "number" && Number.isFinite(value)
							&& value >= LayoutSettingsStore.MinimumDimension && value <= LayoutSettingsStore.MaximumDimension)
						{
							preferences.dimensions[name] = value;
						}
					}
				}
			}
		}
		catch
		{
			// Invalid preferences fall back to safe defaults.
		}

		return preferences;
	}

	// Persists the current layout preference record.
	private Save(): void
	{
		try
		{
			window.localStorage.setItem(LayoutSettingsStore.StorageKey, JSON.stringify(this.preferences));
		}
		catch
		{
			// Layout remains usable for the current session when storage is unavailable.
		}
	}

	// Narrows persisted property names to supported layout dimensions.
	private IsDimensionName(name: string): name is LayoutDimension
	{
		const names: readonly string[] = [
			"leftPaneWidth",
			"editorPaneWidth",
			"signalNavigationWidth",
			"lookupHeight",
			"dreamSourceHeight",
			"dreamReflectionsHeight",
			"dreamSynopticViewHeight",
			"ideaSeeingHeight",
			"chatComposerHeight"
		];
		const isDimension = names.includes(name);

		return isDimension;
	}
}

// Shared layout preference owner used by renderer feature panels.
export const LayoutSettings = new LayoutSettingsStore();
