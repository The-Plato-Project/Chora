import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { CloseActionMenusOutside } from "../ui/ActionMenus.js";
import { DocumentIcon } from "../ui/Icons.js";

// Persistent DOM roots supplied to the feature panels mounted by application composition.
export interface WorkspaceRoots
{
	// Explorer catalogue and folder tree.
	readonly explorer: HTMLElement;
	// Open Dream editor tab strip.
	readonly tabs: HTMLElement;
	// Source-document reading surface.
	readonly document: HTMLElement;
	// Dream editing surface.
	readonly dream: HTMLElement;
	// Native dictionary toolbar surface.
	readonly lookup: HTMLElement;
}

// Owns shell markup, editor visibility, local menus, and DOM-to-workflow event translation.
export class WorkspaceShellPanel
{
	// Visibility subscriptions released when the shell is disposed.
	private readonly subscriptions: Unsubscribe[] = [];
	// Delegated local menu-dismiss listener.
	private readonly menuHandler = this.HandleMenuDismiss.bind(this);
	// DOM shortcut listener that publishes commands without invoking feature workflows.
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	// Native focus translated into a typed workspace event.
	private readonly focusHandler = this.HandleFocus.bind(this);
	// Native blur translated into a typed workspace event.
	private readonly blurHandler = this.HandleBlur.bind(this);

	// Mounts the persistent application shell and attaches its DOM behavior.
	public constructor(private readonly root: HTMLElement, private readonly events: ChoraEventBus<ChoraEvents>)
	{
		this.root.innerHTML = `<main class="shell dream-open"><aside class="left-panel"><nav class="collapsed-explorer-rail" aria-label="Explorer sections"><button class="collapsed-explorer-button button-control" data-expand-explorer="dream" type="button" title="Expand Dreams" aria-label="Expand Dreams">${DocumentIcon}</button></nav><div class="left-view workspace-explorer-host" data-workspace-explorer></div></aside><section class="center-panel" data-document-panel></section><aside class="right-panel" data-editor-panel><div data-workspace-tabs></div><section class="editor-empty-state workspace-welcome" data-editor-empty aria-labelledby="editor-empty-heading"><h1 id="editor-empty-heading">Workspace</h1><p>Select a Dream from the Explorer.</p></section><div data-dream-panel hidden></div></aside><div class="panel-resize-handle" data-resize-pane="left" role="separator" tabindex="0" aria-label="Resize Explorer" aria-orientation="vertical"></div><div class="panel-resize-handle" data-resize-pane="dream" role="separator" tabindex="0" aria-label="Resize editor" aria-orientation="vertical"></div></main>`;
		const readerColumn = this.RequireElement("[data-document-panel]");
		readerColumn.removeAttribute("data-document-panel");
		readerColumn.innerHTML = '<div class="reader-workspace"><section class="document-panel" data-document-panel></section><section data-lookup-panel aria-label="Dictionary" hidden></section></div>';
		this.subscriptions.push(events.Subscribe("dream.opened", this.HandleDreamOpened.bind(this)));
		this.subscriptions.push(events.Subscribe("dream.closed", this.HandleDreamClosed.bind(this)));
		root.addEventListener("pointerdown", this.menuHandler);
		root.addEventListener("focusin", this.menuHandler);
		window.addEventListener("keydown", this.keyHandler);
		window.addEventListener("focus", this.focusHandler);
		window.addEventListener("blur", this.blurHandler);
	}

	// Supplies the already-mounted roots to feature composition without rebuilding their DOM.
	public GetRoots(): WorkspaceRoots
	{
		const explorer = this.RequireElement("[data-workspace-explorer]");
		const tabs = this.RequireElement("[data-workspace-tabs]");
		const document = this.RequireElement("[data-document-panel]");
		const dream = this.RequireElement("[data-dream-panel]");
		const lookup = this.RequireElement("[data-lookup-panel]");
		const roots: WorkspaceRoots = { explorer, tabs, document, dream, lookup };
		return roots;
	}

	// Releases shell listeners and feature visibility subscriptions.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		this.root.removeEventListener("pointerdown", this.menuHandler);
		this.root.removeEventListener("focusin", this.menuHandler);
		window.removeEventListener("keydown", this.keyHandler);
		window.removeEventListener("focus", this.focusHandler);
		window.removeEventListener("blur", this.blurHandler);
	}

	// Shows the editor only in response to a completed Dream-open event.
	private HandleDreamOpened(): void
	{
		this.ShowEditorPanel("dream");
	}

	// Restores the welcome surface after the last Dream editor closes.
	private HandleDreamClosed(): void
	{
		this.ShowEditorPanel(null);
	}

	// Dismisses only action menus outside the new pointer or focus target.
	private HandleMenuDismiss(event: Event): void
	{
		CloseActionMenusOutside(this.root, event.target as Node | null);
	}

	// Lets the workflow owner decide whether catalogue state should refresh on activation.
	private HandleFocus(): void
	{
		void this.events.PublishAsync("workspace.focused", {});
	}

	// Reports whether modal UI permits a blur-triggered save.
	private HandleBlur(): void
	{
		CloseActionMenusOutside(this.root, null);
		const canSave = document.querySelector(".catalogue-reload-dialog[open]") === null;
		void this.events.PublishAsync("workspace.blurred", { canSave });
	}

	// Converts keyboard gestures into typed requests rather than coordinating Dream persistence.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const command = event.ctrlKey || event.metaKey;
		const target = event.target as HTMLElement | null;
		const editable = target?.matches("input, textarea, [contenteditable=true]") ?? false;
		if (event.key === "Escape")
		{
			const menus = this.root.querySelectorAll<HTMLDetailsElement>(".action-menu[open]");
			for (const menu of Array.from(menus))
			{
				menu.open = false;
				menu.querySelector<HTMLElement>("summary")?.focus();
			}
		}
		if (command && event.key.toLowerCase() === "d" && !editable)
		{
			void this.events.PublishAsync("workspace.create-dream-requested", {});
		}
		if (command && event.key === "Enter")
		{
			event.preventDefault();
			void this.events.PublishAsync("workspace.save-requested", {});
		}
	}

	// Shows one feature editor in the shared right pane.
	private ShowEditorPanel(editor: "dream" | null): void
	{
		this.root.querySelector(".shell")?.classList.add("dream-open");
		this.root.querySelector<HTMLElement>("[data-editor-panel]")?.removeAttribute("hidden");
		this.root.querySelector<HTMLElement>("[data-editor-empty]")?.toggleAttribute("hidden", editor !== null);
		this.root.querySelector<HTMLElement>("[data-dream-panel]")?.toggleAttribute("hidden", editor !== "dream");
	}

	// Returns a required root element, throwing when the application markup is missing it.
	private RequireElement(selector: string): HTMLElement
	{
		const element = this.root.querySelector<HTMLElement>(selector);

		if (element === null) throw new Error(`Application element not found: ${selector}`);

		return element;
	}
}
