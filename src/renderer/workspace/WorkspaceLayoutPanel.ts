import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { LayoutSettings, type SplitViewState } from "../core/settings/LayoutSettingsStore.js";
import { SplitViewControl } from "../ui/controls/SplitViewControl.js";

// Composes feature roots into split groups; feature contents know nothing about their hosts.
export class WorkspaceLayoutPanel
{
	// Main Explorer, Vision, and canonical-text columns.
	private readonly columns: SplitViewControl;
	// Workspace and Word Lookup rows above the permanent status bar.
	private readonly rows: SplitViewControl;
	// Availability/navigation notifications translated into generic host operations.
	private readonly subscriptions: Unsubscribe[] = [];
	// Restored navigation changes availability without undoing saved collapse choices.
	private restoring = false;

	// Adding another surface requires only AddPane; no new drag handlers or CSS tracks.
	public constructor(root: HTMLElement, events: ChoraEventBus<ChoraEvents>)
	{
		const columnsRoot = this.RequireElement(root, ".workspace-columns");
		const rowsRoot = this.RequireElement(root, ".workspace-layout");
		const explorer = this.RequireElement(root, ".left-panel");
		const editor = this.RequireElement(root, ".right-panel");
		const reader = this.RequireElement(root, ".center-panel");
		const words = this.RequireElement(root, "[data-word-panel]");
		this.columns = new SplitViewControl({ Direction: "columns", State: LayoutSettings.GetSplitView("workspace-columns"),
			Changed: this.SaveColumns.bind(this) }, columnsRoot);
		// Old settings are read only as initial defaults when no split snapshot exists.
		this.columns.AddPane({ Id: "explorer", Label: "Explorer", Content: explorer,
			Size: LayoutSettings.GetDimension("leftPaneWidth", 220), Collapsed: LayoutSettings.GetExplorerCollapsed() });
		this.columns.AddPane({ Id: "vision", Label: "Vision", Content: editor,
			Size: LayoutSettings.GetDimension("editorPaneWidth", 460), Visible: false });
		this.columns.AddPane({ Id: "text", Label: "Text", Content: reader, Size: 500, Fill: true });
		this.rows = new SplitViewControl({ Direction: "rows", State: LayoutSettings.GetSplitView("workspace-rows"),
			Changed: this.SaveRows.bind(this) }, rowsRoot);
		this.rows.AddPane({ Id: "workspace", Label: "Workspace", Content: columnsRoot, Size: 500, Fill: true });
		this.rows.AddPane({ Id: "words", Label: "Word Lookup", Content: words,
			Size: LayoutSettings.GetDimension("wordPaneHeight", 220), Visible: false });
		this.SaveColumns(this.columns.GetState());
		this.SaveRows(this.rows.GetState());
		this.subscriptions.push(events.Subscribe("application.restoring", this.BeginRestore.bind(this)));
		this.subscriptions.push(events.Subscribe("application.restored", this.EndRestore.bind(this)));
		this.subscriptions.push(events.Subscribe("workspace.sidebar-open-requested", this.ShowExplorer.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.opened", this.ShowVision.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.closed", this.HideVision.bind(this)));
		this.subscriptions.push(events.Subscribe("library.text-opened", this.ShowText.bind(this)));
		this.subscriptions.push(events.Subscribe("word.exploration-requested", this.ShowWords.bind(this)));
		this.subscriptions.push(events.Subscribe("word.lemma-open-requested", this.ShowWords.bind(this)));
		this.subscriptions.push(events.Subscribe("word.exploration-visibility-changed", this.SetWordsAvailable.bind(this)));
	}

	// Releases the framework after the application has disposed its feature owners.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
		this.columns.Dispose();
		this.rows.Dispose();
	}

	// Explicit navigation restores the relevant host and its enclosing workspace row.
	private ShowExplorer(): void
	{
		this.rows.SetPaneCollapsed("workspace", false);
		this.columns.SetPaneCollapsed("explorer", false);
	}

	// A newly opened document is available independently of its content's rendering.
	private ShowVision(): void
	{
		this.columns.SetPaneVisible("vision", true);
		if (!this.restoring)
		{
			this.rows.SetPaneCollapsed("workspace", false);
			this.columns.SetPaneCollapsed("vision", false);
		}
	}

	// Removes an unavailable surface without losing its remembered width.
	private HideVision(): void
	{
		this.columns.SetPaneVisible("vision", false);
	}

	// Source navigation can reopen a completely collapsed reading host.
	private ShowText(): void
	{
		if (!this.restoring)
		{
			this.rows.SetPaneCollapsed("workspace", false);
			this.columns.SetPaneCollapsed("text", false);
		}
	}

	// A deliberate lookup reopens the bottom row; ordinary content updates do not.
	private ShowWords(): void
	{
		this.rows.SetPaneVisible("words", true);
		this.rows.SetPaneCollapsed("words", false);
	}

	// Content reports availability through an event instead of inspecting parent geometry.
	private SetWordsAvailable(event: ChoraEvents["word.exploration-visibility-changed"]): void
	{
		this.rows.SetPaneVisible("words", event.visible);
	}

	// Persists feature-independent column state after completed interactions.
	private SaveColumns(state: SplitViewState): void
	{
		if (!this.restoring) LayoutSettings.SetSplitView("workspace-columns", state);
	}

	// Persists feature-independent row state after completed interactions.
	private SaveRows(state: SplitViewState): void
	{
		if (!this.restoring) LayoutSettings.SetSplitView("workspace-rows", state);
	}

	private BeginRestore(): void
	{
		this.restoring = true;
	}

	private EndRestore(): void
	{
		this.restoring = false;
		this.SaveColumns(this.columns.GetState());
		this.SaveRows(this.rows.GetState());
	}

	// Finds one composition root without delegating layout work to its feature content.
	private RequireElement(root: HTMLElement, selector: string): HTMLElement
	{
		const element = root.querySelector<HTMLElement>(selector);
		if (element === null)
		{
			throw new Error(`Missing workspace surface: ${selector}`);
		}
		return element;
	}
}
