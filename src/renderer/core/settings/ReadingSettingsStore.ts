// Global appearance preference shared across every renderer surface.
export type Appearance = "light" | "dark";

// Global reading font family shared by reading and writing surfaces.
export type ReadingFont = "serif" | "sans";

// Persisted global reading preferences.
interface ReadingPreferences
{
	fontSize: number;
	font: ReadingFont;
	appearance: Appearance;
	anchorHighlightColor: string;
}

// Owns global reading settings and applies them to the document root as shared CSS variables.
export class ReadingSettingsStore
{
	// Local storage key for persisted reading preferences.
	private static readonly StorageKey = "chora:reading-settings";
	// Font stacks applied for each reading font choice.
	private static readonly SerifStack = `"Iowan Old Style", "Palatino Linotype", Georgia, serif`;
	private static readonly SansStack = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
	// Bounds enforced on the reading font size.
	private static readonly MinimumFontSize = 10;
	private static readonly MaximumFontSize = 32;
	private static readonly DefaultAnchorHighlightColor = "#b65e3b";
	// Currently applied reading preferences.
	private preferences: ReadingPreferences = this.Load();

	// Returns the current reading font size in pixels.
	public GetFontSize(): number
	{
		return this.preferences.fontSize;
	}

	// Returns the current reading font family.
	public GetFont(): ReadingFont
	{
		return this.preferences.font;
	}

	// Returns the current appearance.
	public GetAppearance(): Appearance
	{
		return this.preferences.appearance;
	}

	public GetAnchorHighlightColor(): string
	{
		return this.preferences.anchorHighlightColor;
	}

	// Changes the reading font size by a step, clamped to the allowed range.
	public ChangeFontSize(delta: number): void
	{
		const next = Math.max(ReadingSettingsStore.MinimumFontSize, Math.min(ReadingSettingsStore.MaximumFontSize, this.preferences.fontSize + delta));
		this.preferences.fontSize = next;
		this.Save();
		this.Apply();
	}

	// Sets the reading font family.
	public SetFont(font: ReadingFont): void
	{
		this.preferences.font = font;
		this.Save();
		this.Apply();
	}

	public SetAnchorHighlightColor(color: string): void
	{
		if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new Error("The anchor highlight color is invalid.");
		this.preferences.anchorHighlightColor = color.toLocaleLowerCase();
		this.Save();
		this.Apply();
	}

	// Toggles between light and dark appearance.
	public ToggleAppearance(): void
	{
		this.preferences.appearance = this.preferences.appearance === "light" ? "dark" : "light";
		this.Save();
		this.Apply();
	}

	// Writes the current preferences to the document root for every surface to inherit.
	public Apply(): void
	{
		const root = document.documentElement;
		const stack = this.preferences.font === "sans" ? ReadingSettingsStore.SansStack : ReadingSettingsStore.SerifStack;
		root.style.setProperty("--reading-font-size", `${this.preferences.fontSize}px`);
		root.style.setProperty("--reading-font", stack);
		root.style.setProperty("--vision-reference-color", this.preferences.anchorHighlightColor);
		root.dataset.theme = this.preferences.appearance;
	}

	// Reads persisted preferences from local storage, falling back to defaults when missing or invalid.
	private Load(): ReadingPreferences
	{
		const preferences: ReadingPreferences = {
			fontSize: 18,
			font: "serif",
			appearance: "light",
			anchorHighlightColor: ReadingSettingsStore.DefaultAnchorHighlightColor
		};

		try
		{
			const stored = window.localStorage.getItem(ReadingSettingsStore.StorageKey);
			if (stored !== null)
			{
				const candidate = JSON.parse(stored) as Partial<ReadingPreferences>;
				if (typeof candidate.fontSize === "number" && candidate.fontSize >= ReadingSettingsStore.MinimumFontSize && candidate.fontSize <= ReadingSettingsStore.MaximumFontSize) preferences.fontSize = candidate.fontSize;
				if (candidate.font === "serif" || candidate.font === "sans") preferences.font = candidate.font;
				if (candidate.appearance === "light" || candidate.appearance === "dark") preferences.appearance = candidate.appearance;
				if (typeof candidate.anchorHighlightColor === "string" && /^#[0-9a-f]{6}$/iu.test(candidate.anchorHighlightColor))
				{
					preferences.anchorHighlightColor = candidate.anchorHighlightColor.toLocaleLowerCase();
				}
			}
		}
		catch
		{
			// Invalid preferences fall back to the defaults.
		}

		return preferences;
	}

	// Persists the current preferences to local storage.
	private Save(): void
	{
		try
		{
			window.localStorage.setItem(ReadingSettingsStore.StorageKey, JSON.stringify(this.preferences));
		}
		catch
		{
			// Settings remain available for the current session when storage is unavailable.
		}
	}
}
