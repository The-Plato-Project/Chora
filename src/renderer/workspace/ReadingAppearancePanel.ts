import { ReadingSettingsStore, type ReadingFont } from "../core/settings/ReadingSettingsStore.js";

// Owns appearance-control DOM interactions while ReadingSettingsStore owns persisted preferences.
export class ReadingAppearancePanel
{
	// Click handler shared by appearance and font-size controls.
	private readonly clickHandler = this.HandleLeftViewClick.bind(this);
	// Change handler for the reading-font selector.
	private readonly changeHandler = this.HandleSettingsChange.bind(this);

	// Applies the current preferences and attaches their existing controls.
	public constructor(private readonly root: HTMLElement, private readonly settings: ReadingSettingsStore)
	{
		settings.Apply();
		root.addEventListener("click", this.clickHandler);
		root.addEventListener("change", this.changeHandler);
	}

	// Releases the preference-control listeners.
	public Dispose(): void
	{
		this.root.removeEventListener("click", this.clickHandler);
		this.root.removeEventListener("change", this.changeHandler);
	}

	// Routes application-level reading-setting controls to their workflows.
	private HandleLeftViewClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const appearanceButton = target?.closest<HTMLElement>("[data-toggle-appearance]");
		const fontStep = target?.closest<HTMLElement>("[data-font-size]")?.dataset.fontSize;

		if (appearanceButton != null)
		{
			this.ToggleAppearance();
		}

		if (fontStep !== undefined)
		{
			this.ChangeFontSize(Number.parseInt(fontStep, 10));
		}

	}

	// Applies a change to the reading-font selector.
	private HandleSettingsChange(event: Event): void
	{
		const target = event.target as HTMLSelectElement | null;

		if (target?.matches("[data-reading-font]") === true)
		{
			this.settings.SetFont(target.value as ReadingFont);
		}
	}

	// Applies a font-size step and reflects the new value in the toolbar.
	private ChangeFontSize(delta: number): void
	{
		this.settings.ChangeFontSize(delta);
		const value = this.root.querySelector<HTMLElement>("[data-font-size-value]");
		if (value !== null) value.textContent = String(this.settings.GetFontSize());
	}

	// Toggles light/dark appearance and reflects the current theme in reading settings.
	private ToggleAppearance(): void
	{
		this.settings.ToggleAppearance();
		const button = this.root.querySelector<HTMLElement>("[data-toggle-appearance]");
		const value = button?.querySelector<HTMLElement>("[data-appearance-value]");
		const isLight = this.settings.GetAppearance() === "light";
		const label = isLight ? "Use dark appearance" : "Use light appearance";

		if (button !== null)
		{
			button.title = label;
			button.setAttribute("aria-label", label);
		}
		if (value !== null && value !== undefined) value.textContent = isLight ? "Light" : "Dark";
	}
}
