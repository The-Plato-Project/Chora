import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";

// Describes a built-in sidebar contribution and its owned lifetime.
export interface WorkspaceSidebarExtension
{
	readonly id: string;
	readonly title: string;
	readonly icon: string;
	Mount(root: HTMLElement): { Dispose(): void };
}

// Keeps the UI elements and lifecycle owner of one contribution together.
interface SidebarPanel
{
	readonly root: HTMLElement;
	readonly button: HTMLButtonElement;
	readonly owner: { Dispose(): void };
}

// Owns sidebar registration, persistent panels, activity selection, and disposal.
export class WorkspaceSidebar
{
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly panels = new Map<string, SidebarPanel>();
	private readonly clickHandler = this.HandleClick.bind(this);
	private selectedId = "";

	public constructor(
		private readonly rail: HTMLElement,
		private readonly host: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		extensions: readonly WorkspaceSidebarExtension[])
	{
		const ids = new Set<string>();
		for (const extension of extensions)
		{
			const valid = /^[a-z][a-z0-9-]*$/u.test(extension.id);
			const duplicate = ids.has(extension.id);
			if (!valid || duplicate)
			{
				throw new Error(`Invalid or duplicate sidebar extension: ${extension.id}`);
			}
			ids.add(extension.id);
		}
		const hasExplorer = ids.has("explorer");
		if (!hasExplorer)
		{
			throw new Error("The Explorer sidebar extension is required.");
		}
		const focusExplorer = this.SelectExplorer.bind(this);
		const openExplorer = this.OpenExplorerAsync.bind(this);
		const selectPanel = this.SelectRequestedAsync.bind(this);
		const focusSubscription = events.Subscribe("workspace.dreams-focus-requested", focusExplorer);
		const filterSubscription = events.Subscribe("dream.passage-filter-changed", openExplorer);
		const selectSubscription = events.Subscribe("workspace.sidebar-select-requested", selectPanel);
		this.subscriptions.push(focusSubscription);
		this.subscriptions.push(filterSubscription);
		this.subscriptions.push(selectSubscription);
		for (const extension of extensions)
		{
			const button = document.createElement("button");
			button.type = "button";
			button.className = "workspace-activity-button button-control";
			button.dataset.sidebarId = extension.id;
			button.title = extension.title;
			button.setAttribute("aria-label", extension.title);
			button.setAttribute("aria-pressed", "false");
			button.innerHTML = extension.icon;
			const root = document.createElement("section");
			root.className = "workspace-sidebar-panel";
			root.setAttribute("aria-label", extension.title);
			root.hidden = true;
			this.rail.append(button);
			this.host.append(root);
			const owner = extension.Mount(root);
			const panel: SidebarPanel = { root, button, owner };
			this.panels.set(extension.id, panel);
		}
		this.rail.addEventListener("click", this.clickHandler);
		this.Select("explorer");
	}

	public Dispose(): void
	{
		this.rail.removeEventListener("click", this.clickHandler);
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		const panels = this.panels.values();
		for (const panel of panels)
		{
			panel.owner.Dispose();
			panel.root.remove();
			panel.button.remove();
		}
		this.subscriptions.length = 0;
		this.panels.clear();
	}

	private Select(id: string): void
	{
		const exists = this.panels.has(id);
		if (!exists)
		{
			throw new Error(`Unknown sidebar extension: ${id}`);
		}
		for (const [panelId, panel] of this.panels)
		{
			const selected = panelId === id;
			const pressed = String(selected);
			panel.root.hidden = !selected;
			panel.button.setAttribute("aria-pressed", pressed);
		}
		this.selectedId = id;
	}

	private SelectExplorer(): void
	{
		this.Select("explorer");
	}

	private async OpenExplorerAsync(): Promise<void>
	{
		this.Select("explorer");
		await this.events.PublishAsync("workspace.sidebar-open-requested", {});
	}

	private async SelectRequestedAsync(event: ChoraEvents["workspace.sidebar-select-requested"]): Promise<void>
	{
		this.Select(event.id);
		await this.events.PublishAsync("workspace.sidebar-open-requested", {});
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>("[data-sidebar-id]");
		const id = button?.dataset.sidebarId;
		if (id !== undefined)
		{
			const exists = this.panels.has(id);
			if (exists)
			{
				void this.ActivateAsync(id);
			}
		}
	}

	private async ActivateAsync(id: string): Promise<void>
	{
		this.Select(id);
		await this.events.PublishAsync("workspace.sidebar-open-requested", {});
		if (id === "explorer" && this.selectedId === id)
		{
			await this.events.PublishAsync("workspace.dreams-focus-requested", {});
		}
	}
}
