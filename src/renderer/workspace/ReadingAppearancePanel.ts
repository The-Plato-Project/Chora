import { ReadingSettingsStore } from "../core/settings/ReadingSettingsStore.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { DialogControl } from "../ui/controls/DialogControl.js";
import { ReadingAppearanceGateway } from "./ReadingAppearanceGateway.js";

// Owns application settings DOM; the existing settings store remains authoritative.
export class ReadingAppearancePanel
{
	// Shared modal commits draft preferences only when the reader chooses OK.
	private readonly dialog: DialogControl;
	private readonly unsubscribe: Unsubscribe;

	// Native menu requests arrive as typed application events.
	public constructor(private readonly settings: ReadingSettingsStore, events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager, private readonly gateway = new ReadingAppearanceGateway())
	{
		settings.Apply();
		this.dialog = new DialogControl(errors);
		this.unsubscribe = events.Subscribe("workspace.settings-open-requested", this.Open.bind(this));
		void this.ApplyNativeAppearanceAsync();
	}

	// Reopens from persisted preferences so Cancel discards all uncommitted input.
	private Open(): void
	{
		const font = this.settings.GetFont();
		const appearance = this.settings.GetAppearance();
		this.dialog.Open({
			Title: "Chora settings",
			Content: `<div class="application-settings-fields">
				<label class="control-field"><span>Theme</span><select data-appearance><option value="light"${appearance === "light" ? " selected" : ""}>Light</option><option value="dark"${appearance === "dark" ? " selected" : ""}>Dark</option></select></label>
				<label class="control-field"><span>Reading font</span><select data-reading-font><option value="serif"${font === "serif" ? " selected" : ""}>Serif</option><option value="sans"${font === "sans" ? " selected" : ""}>Sans</option></select></label>
				<label class="control-field"><span>Text size</span><input class="control-input" data-reading-size type="number" min="10" max="32" step="1" required value="${this.settings.GetFontSize()}"></label>
				<label class="control-field"><span>Greek anchor highlight</span><input data-anchor-highlight-color type="color" value="${this.settings.GetAnchorHighlightColor()}"></label>
			</div>`,
			CommitAsync: this.Commit.bind(this),
			InitialFocus: "[data-appearance]"
		});
	}

	// Applies validated preferences through their existing owner after explicit confirmation.
	private Commit(): boolean
	{
		const font = this.dialog.Content.querySelector<HTMLSelectElement>("[data-reading-font]")!.value;
		const appearance = this.dialog.Content.querySelector<HTMLSelectElement>("[data-appearance]")!.value;
		const size = this.dialog.Content.querySelector<HTMLInputElement>("[data-reading-size]")!.valueAsNumber;
		const color = this.dialog.Content.querySelector<HTMLInputElement>("[data-anchor-highlight-color]")!.value;
		const valid = (font === "serif" || font === "sans") && (appearance === "light" || appearance === "dark")
			&& Number.isInteger(size) && size >= 10 && size <= 32 && /^#[0-9a-f]{6}$/iu.test(color);
		if (valid)
		{
			this.settings.SetFont(font);
			this.settings.ChangeFontSize(size - this.settings.GetFontSize());
			this.settings.SetAnchorHighlightColor(color);
			if (this.settings.GetAppearance() !== appearance)
			{
				this.settings.ToggleAppearance();
				void this.ApplyNativeAppearanceAsync();
			}
		}
		return valid;
	}

	// Keeps native title/menu chrome in step with the persisted application theme.
	private async ApplyNativeAppearanceAsync(): Promise<void>
	{
		try
		{
			await this.gateway.ApplyAsync(this.settings.GetAppearance());
		}
		catch (error)
		{
			this.errors.Report("ReadingAppearance", error, "The native window appearance could not be updated.");
		}
	}

	// Releases both the application event and the reusable modal.
	public Dispose(): void
	{
		this.unsubscribe();
		this.dialog.Dispose();
	}
}
