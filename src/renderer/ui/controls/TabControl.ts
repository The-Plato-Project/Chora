import { TabPanel } from "./TabPanel.js";

// Owns persistent panels and accessible tab selection, independent of feature data.
export class TabControl
{
	// Allocates unique DOM identities across controls.
	private static nextId = 0;
	// Persistent control root.
	public readonly Root: HTMLElement = document.createElement("div");
	// Owned panel collection.
	private readonly panels: TabPanel[] = [];
	// Tab buttons in panel order.
	private readonly buttons: HTMLButtonElement[] = [];
	private readonly list: HTMLElement = document.createElement("div");
	private readonly prefix: string;
	private nextPanelId = 0;
	// Current selected index.
	private selectedIndex = -1;
	// Keyboard listener retained for disposal.
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	// Click listener retained for disposal.
	private readonly clickHandler = this.HandleClick.bind(this);

	// Mounts each panel once and initially selects the first.
	public constructor(
		panels: readonly TabPanel[],
		label: string,
		private readonly selectionChanged?: (id: string) => void,
		private readonly closeRequested?: (id: string) => void)
	{
		const ids = new Set<string>();
		for (const panel of panels)
		{
			if (ids.has(panel.Id)) throw new Error("Tab panel identifiers must be unique.");
			ids.add(panel.Id);
		}
		TabControl.nextId += 1;
		this.prefix = `tabs-${TabControl.nextId}`;
		this.list.className = "tab-list";
		this.list.setAttribute("role", "tablist");
		this.list.setAttribute("aria-label", label);
		this.Root.className = "tab-control";
		this.Root.append(this.list);
		for (const panel of panels) this.Add(panel, false);
		this.list.addEventListener("click", this.clickHandler);
		this.list.addEventListener("keydown", this.keyHandler);
		const first = this.panels[0];
		if (first !== undefined) this.Select(first.Id);
	}

	public get Panels(): readonly TabPanel[]
	{
		return this.panels;
	}

	public Add(panel: TabPanel, closable = false): void
	{
		if (this.panels.some((candidate) => candidate.Id === panel.Id))
			throw new Error("Tab panel identifiers must be unique.");
		const identity = this.nextPanelId;
		this.nextPanelId += 1;
		const item = document.createElement("div");
		item.className = "tab-item";
		const button = document.createElement("button");
		button.type = "button";
		button.id = `${this.prefix}-tab-${identity}`;
		button.dataset.tabId = panel.Id;
		button.textContent = panel.Title;
		button.setAttribute("role", "tab");
		panel.Root.id = `${this.prefix}-panel-${identity}`;
		button.setAttribute("aria-controls", panel.Root.id);
		panel.Root.setAttribute("aria-labelledby", button.id);
		item.append(button);
		if (closable)
		{
			const close = document.createElement("button");
			close.type = "button";
			close.className = "tab-close";
			close.dataset.tabClose = panel.Id;
			close.setAttribute("aria-label", `Close ${panel.Title}`);
			close.title = `Close ${panel.Title}`;
			close.textContent = "×";
			item.append(close);
		}
		this.panels.push(panel);
		this.buttons.push(button);
		this.list.append(item);
		this.Root.append(panel.Root);
		if (this.selectedIndex < 0) this.Select(panel.Id);
		else this.UpdateSelection();
	}

	public Remove(id: string): void
	{
		const index = this.panels.findIndex((panel) => panel.Id === id);
		if (index < 0) return;
		const wasSelected = index === this.selectedIndex;
		const panel = this.panels[index];
		const button = this.buttons[index];
		button?.closest(".tab-item")?.remove();
		panel?.Dispose();
		this.panels.splice(index, 1);
		this.buttons.splice(index, 1);
		if (this.panels.length === 0)
		{
			this.selectedIndex = -1;
			return;
		}
		if (index < this.selectedIndex || this.selectedIndex >= this.panels.length) this.selectedIndex -= 1;
		if (wasSelected)
		{
			this.selectedIndex = Math.max(0, Math.min(index, this.panels.length - 1));
			this.UpdateSelection();
			const selected = this.panels[this.selectedIndex];
			if (selected !== undefined) this.selectionChanged?.(selected.Id);
		}
		else this.UpdateSelection();
	}

	public UpdateTitle(id: string, title: string): void
	{
		const index = this.panels.findIndex((panel) => panel.Id === id);
		const button = this.buttons[index];
		if (button !== undefined) button.textContent = title;
		const close = button?.closest(".tab-item")?.querySelector<HTMLButtonElement>("[data-tab-close]");
		if (close !== null && close !== undefined)
		{
			close.setAttribute("aria-label", `Close ${title}`);
			close.title = `Close ${title}`;
		}
	}

	// Selects content without replacing nodes or moving focus programmatically.
	public Select(id: string): void
	{
		const previous = this.selectedIndex;
		for (let index = 0; index < this.panels.length; index += 1)
		{
			if (this.panels[index]?.Id === id) this.selectedIndex = index;
		}
		this.UpdateSelection();
		const selected = this.panels[this.selectedIndex];
		if (selected !== undefined && previous !== this.selectedIndex)
		{
			selected.OnSelected();
			this.selectionChanged?.(selected.Id);
		}
	}

	// Returns the identifier of the selected panel, or null when the control is empty.
	public GetSelectedId(): string | null
	{
		const id = this.panels[this.selectedIndex]?.Id ?? null;

		return id;
	}

	// Releases listeners and all owned panels.
	public Dispose(): void
	{
		this.list.removeEventListener("click", this.clickHandler);
		this.list.removeEventListener("keydown", this.keyHandler);
		for (const panel of this.panels) panel.Dispose();
		this.panels.length = 0;
		this.buttons.length = 0;
		this.Root.remove();
	}

	// Selects a clicked tab belonging to this control.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const close = target?.closest<HTMLElement>("[data-tab-close]");
		if (close !== null && close !== undefined)
		{
			const id = close.dataset.tabClose;
			if (id !== undefined) this.closeRequested?.(id);
			return;
		}
		const button = target?.closest("button");
		for (let index = 0; index < this.buttons.length; index += 1)
		{
			const panel = this.panels[index];
			if (this.buttons[index] === button && panel !== undefined) this.Select(panel.Id);
		}
	}

	// Implements automatic activation with arrow, Home, and End keys.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		let index = this.selectedIndex;
		if (this.panels.length === 0) return;
		if (event.key === "ArrowRight") index = (index + 1) % this.panels.length;
		else if (event.key === "ArrowLeft") index = (index - 1 + this.panels.length) % this.panels.length;
		else if (event.key === "Home") index = 0;
		else if (event.key === "End") index = this.panels.length - 1;
		const panel = this.panels[index];
		if (panel !== undefined && ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key))
		{
			event.preventDefault();
			this.Select(panel.Id);
			this.buttons[index]?.focus();
		}
	}

	private UpdateSelection(): void
	{
		for (let index = 0; index < this.panels.length; index += 1)
		{
			const panel = this.panels[index];
			const button = this.buttons[index];
			const selected = index === this.selectedIndex;
			if (panel !== undefined) panel.Root.hidden = !selected;
			if (button !== undefined)
			{
				button.setAttribute("aria-selected", String(selected));
				button.tabIndex = selected ? 0 : -1;
			}
		}
	}
}
