import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { CloseActionMenusOutside } from "../ui/ActionMenus.js";
import { StatusBarControl } from "../ui/controls/StatusBarControl.js";
import { MenuBarControl } from "../ui/controls/MenuBarControl.js";

// Persistent DOM roots supplied to the feature panels mounted by application composition.
export interface WorkspaceRoots
{
	// Explorer catalogue and folder tree.
	readonly sidebarRail: HTMLElement;
	readonly sidebarHost: HTMLElement;
	// Open Vision editor tab strip.
	readonly tabs: HTMLElement;
	// Source-document reading surface.
	readonly document: HTMLElement;
	// Vision writing surface.
	readonly vision: HTMLElement;
	// Full-width word exploration surface below the workspace.
	readonly words: HTMLElement;
}

// Owns shell markup, editor visibility, local menus, and DOM-to-workflow event translation.
export class WorkspaceShellPanel
{
	// Permanent footer sits outside every resizable row and column.
	private readonly statusBar = new StatusBarControl();
	// Shared menu styling belongs to Chora rather than Chromium's native menu popups.
	private readonly menuBar: MenuBarControl;
	// Delegated local menu-dismiss listener.
	private readonly menuHandler = this.HandleMenuDismiss.bind(this);
	// DOM shortcut listener that publishes commands without invoking feature workflows.
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	// Native focus translated into a typed workspace event.
	private readonly focusHandler = this.HandleFocus.bind(this);
	// Native blur translated into a typed workspace event.
	private readonly blurHandler = this.HandleBlur.bind(this);
	// Native menu subscription has the same lifetime as the application shell.
	private readonly settingsUnsubscribe: () => void;

	// Mounts the persistent application shell and attaches its DOM behavior.
	public constructor(private readonly root: HTMLElement, private readonly events: ChoraEventBus<ChoraEvents>)
	{
		this.root.innerHTML = `<main class="shell"><div class="workspace-layout"><div class="workspace-columns"><aside class="left-panel"><nav class="workspace-activity-rail" data-sidebar-rail aria-label="Workspace sections"></nav><div class="left-view workspace-sidebar-host" data-sidebar-host></div></aside><aside class="right-panel" data-editor-panel><div data-workspace-tabs></div><div data-vision-panel></div></aside><section class="center-panel" data-document-panel></section></div><section data-word-panel></section></div></main>`;
		this.menuBar = new MenuBarControl([
			{ Label: "File", Commands: [{ Id: "quit", Label: "Quit", Shortcut: "Ctrl+Q" }] },
			{ Label: "Settings", Commands: [{ Id: "settings", Label: "Chora settings", Shortcut: "Ctrl+," }] },
			{ Label: "Help", Commands: [{ Id: "logs", Label: "Open Logs Folder" }] }
		], this.HandleMenuCommand.bind(this));
		this.menuBar.Root.hidden = window.chora.UsesNativeMenu === true;
		this.root.querySelector(".shell")!.prepend(this.menuBar.Root);
		this.root.querySelector(".shell")!.append(this.statusBar.Root);
		root.addEventListener("pointerdown", this.menuHandler);
		root.addEventListener("focusin", this.menuHandler);
		window.addEventListener("keydown", this.keyHandler);
		window.addEventListener("focus", this.focusHandler);
		window.addEventListener("blur", this.blurHandler);
		this.settingsUnsubscribe = window.chora.SubscribeSettingsRequested(this.HandleSettingsRequested.bind(this));
	}

	// Supplies the already-mounted roots to feature composition without rebuilding their DOM.
	public GetRoots(): WorkspaceRoots
	{
		const sidebarRail = this.RequireElement("[data-sidebar-rail]");
		const sidebarHost = this.RequireElement("[data-sidebar-host]");
		const tabs = this.RequireElement("[data-workspace-tabs]");
		const document = this.RequireElement("[data-document-panel]");
		const vision = this.RequireElement("[data-vision-panel]");
		const words = this.RequireElement("[data-word-panel]");
		const roots: WorkspaceRoots = { sidebarRail, sidebarHost, tabs, document, vision, words };
		return roots;
	}

	// Releases shell listeners and feature visibility subscriptions.
	public Dispose(): void
	{
		this.statusBar.Dispose();
		this.menuBar.Dispose();
		this.settingsUnsubscribe();
		this.root.removeEventListener("pointerdown", this.menuHandler);
		this.root.removeEventListener("focusin", this.menuHandler);
		window.removeEventListener("keydown", this.keyHandler);
		window.removeEventListener("focus", this.focusHandler);
		window.removeEventListener("blur", this.blurHandler);
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

	// Translates the native application command without coupling the shell to settings DOM.
	private HandleSettingsRequested(): void
	{
		void this.events.PublishAsync("workspace.settings-open-requested", {});
	}

	// Converts shared menu command identities into typed application requests.
	private HandleMenuCommand(command: string): void
	{
		if (command === "quit" || command === "settings" || command === "logs")
		{
			void this.events.PublishAsync("workspace.menu-command-requested", { command });
		}
	}

	// Reports whether modal UI permits a blur-triggered save.
	private HandleBlur(): void
	{
		CloseActionMenusOutside(this.root, null);
		const canSave = document.querySelector("dialog[open]") === null;
		void this.events.PublishAsync("workspace.blurred", { canSave });
	}

	// Converts keyboard gestures into typed requests.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const command = event.ctrlKey || event.metaKey;
		if (command && !event.altKey && !event.shiftKey && !window.chora.UsesNativeMenu)
		{
			if (event.key === "," || event.key.toLowerCase() === "q")
			{
				event.preventDefault();
				const action = event.key === "," ? "settings" : "quit";
				this.HandleMenuCommand(action);
			}
		}
		if (event.key === "Escape")
		{
			const menus = this.root.querySelectorAll<HTMLDetailsElement>(".action-menu[open]");
			for (const menu of Array.from(menus))
			{
				menu.open = false;
				menu.querySelector<HTMLElement>("summary")?.focus();
			}
		}
		if (command && event.key === "Enter")
		{
			event.preventDefault();
			void this.events.PublishAsync("workspace.save-requested", {});
		}
	}

	// Returns a required root element, throwing when the application markup is missing it.
	private RequireElement(selector: string): HTMLElement
	{
		const element = this.root.querySelector<HTMLElement>(selector);

		if (element === null) throw new Error(`Application element not found: ${selector}`);

		return element;
	}
}
