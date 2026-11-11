// Names every user-adjustable layout dimension persisted across application restarts.
export type LayoutDimension =
	"leftPaneWidth"
	| "editorPaneWidth"
	| "wordPaneHeight"
	| "wordLemmaWidth"
	| "wordAnalysisWidth"
	| "wordDictionaryWidth"
	| "wordPersonWidth"
	| "wordOccurrencesWidth"
	| "wordOccurrenceNavigationWidth"
	| "wordDictionaryPrimaryWidth"
	| "wordOccurrencesPrimaryWidth"
	| "wordOccurrenceListWidth"
	| "wordDictionaryPrimaryRatio"
	| "wordOccurrenceNavigationRatio"
	| "wordRelatedWidth";

// Durable geometry for one content host, independent of the content attached to it.
export interface SplitPaneState
{
	// Remembered expanded size, retained while a surface is collapsed or unavailable.
	readonly Size: number;
	// A collapsed pane has zero content extent and a reachable adjacent divider.
	readonly Collapsed: boolean;
}

// Stable pane identities allow new rows/columns without changing the storage contract.
export type SplitViewState = Readonly<Record<string, SplitPaneState>>;

// Persisted renderer layout preferences.
interface LayoutPreferences
{
	dimensions: Partial<Record<LayoutDimension, number>>;
	explorerCollapsed: boolean;
	splitViews: Record<string, SplitViewState>;
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

	// Reads one generic split group's saved pane geometry.
	public GetSplitView(id: string): SplitViewState | null
	{
		const state = this.preferences.splitViews[id];
		const snapshot = state === undefined ? null : structuredClone(state);
		return snapshot;
	}

	// Persists a defensive layout snapshot after a completed resize/collapse gesture.
	public SetSplitView(id: string, state: SplitViewState): void
	{
		this.preferences.splitViews[id] = this.ReadSplitView(state);
		this.Save();
	}

	// Validates only geometry, never application feature identities or DOM state.
	private ReadSplitView(value: unknown): SplitViewState
	{
		const state: Record<string, SplitPaneState> = {};
		if (typeof value === "object" && value !== null)
		{
			for (const [id, item] of Object.entries(value))
			{
				if (id !== "__proto__" && typeof item === "object" && item !== null)
				{
					const candidate = item as Partial<SplitPaneState>;
					if (typeof candidate.Size === "number" && Number.isFinite(candidate.Size) && candidate.Size >= 0 && candidate.Size <= 16000
						&& typeof candidate.Collapsed === "boolean")
					{
						state[id] = { Size: candidate.Size, Collapsed: candidate.Collapsed };
					}
				}
			}
		}
		return state;
	}

	// Reads valid persisted layout preferences while discarding corrupt fields.
	private Load(): LayoutPreferences
	{
		const preferences: LayoutPreferences = { dimensions: {}, explorerCollapsed: false, splitViews: {} };

		try
		{
			const stored = window.localStorage.getItem(LayoutSettingsStore.StorageKey);
			if (stored !== null)
			{
				const candidate = JSON.parse(stored) as Partial<LayoutPreferences>;
				if (candidate.explorerCollapsed === true) preferences.explorerCollapsed = true;
				if (typeof candidate.splitViews === "object" && candidate.splitViews !== null)
				{
					for (const [id, value] of Object.entries(candidate.splitViews))
					{
						if (id !== "__proto__")
						{
							preferences.splitViews[id] = this.ReadSplitView(value);
						}
					}
				}
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
			"wordPaneHeight",
			"wordLemmaWidth",
			"wordAnalysisWidth",
			"wordDictionaryWidth",
			"wordPersonWidth",
			"wordOccurrencesWidth",
			"wordOccurrenceNavigationWidth",
			"wordDictionaryPrimaryWidth",
			"wordOccurrencesPrimaryWidth",
			"wordOccurrenceListWidth",
			"wordDictionaryPrimaryRatio",
			"wordOccurrenceNavigationRatio",
			"wordRelatedWidth"
		];
		const isDimension = names.includes(name);

		return isDimension;
	}
}

// Shared layout preference owner used by renderer feature panels.
export const LayoutSettings = new LayoutSettingsStore();
