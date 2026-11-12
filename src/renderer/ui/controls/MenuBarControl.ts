// One application-independent menu command and its optional shortcut label.
export interface MenuBarCommand
{
	readonly Id: string;
	readonly Label: string;
	readonly Shortcut?: string;
}

// A named group of commands presented by the shared menu bar.
export interface MenuBarGroup
{
	readonly Label: string;
	readonly Commands: readonly MenuBarCommand[];
}

// Owns rectangular menus, keyboard navigation, focus restoration, and dismissal.
export class MenuBarControl
{
	// Persistent application menu surface.
	public readonly Root: HTMLElement = document.createElement("nav");
	// Trigger and popup pairs remain mounted for the lifetime of this control.
	private readonly triggers: HTMLButtonElement[] = [];
	private readonly menus: HTMLElement[] = [];
	// Open group and the reader's focus before opening it.
	private openIndex = -1;
	private previousFocus: HTMLElement | null = null;
	// Retained listeners are removed on disposal.
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly hoverHandler = this.HandleHover.bind(this);
	private readonly pointerHandler = this.HandlePointerDown.bind(this);
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	private readonly outsideHandler = this.HandleOutside.bind(this);
	private readonly blurHandler = this.Close.bind(this, false);

	// Accepts product-owned commands without depending on application workflows.
	public constructor(groups: readonly MenuBarGroup[], private readonly selected: (id: string) => void)
	{
		this.Root.className = "menu-bar-control";
		this.Root.setAttribute("role", "menubar");
		this.Root.setAttribute("aria-label", "Application menu");
		for (const group of groups)
		{
			const wrapper = document.createElement("div");
			wrapper.className = "menu-bar-group";
			wrapper.setAttribute("role", "none");
			const trigger = document.createElement("button");
			trigger.type = "button";
			trigger.className = "menu-bar-trigger";
			trigger.textContent = group.Label;
			trigger.dataset.menuGroup = String(this.triggers.length);
			trigger.tabIndex = this.triggers.length === 0 ? 0 : -1;
			trigger.setAttribute("role", "menuitem");
			trigger.setAttribute("aria-haspopup", "menu");
			trigger.setAttribute("aria-expanded", "false");
			const menu = document.createElement("div");
			menu.className = "menu-bar-popup";
			menu.setAttribute("role", "menu");
			menu.setAttribute("aria-label", group.Label);
			menu.hidden = true;
			for (const command of group.Commands)
			{
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.menuCommand = command.Id;
				button.tabIndex = -1;
				button.setAttribute("role", "menuitem");
				const label = document.createElement("span");
				label.textContent = command.Label;
				button.append(label);
				if (command.Shortcut !== undefined)
				{
					const shortcut = document.createElement("span");
					shortcut.className = "menu-bar-shortcut";
					shortcut.textContent = command.Shortcut;
					shortcut.setAttribute("aria-hidden", "true");
					button.append(shortcut);
				}
				menu.append(button);
			}
			this.triggers.push(trigger);
			this.menus.push(menu);
			wrapper.append(trigger, menu);
			this.Root.append(wrapper);
		}
		this.Root.addEventListener("click", this.clickHandler);
		this.Root.addEventListener("pointerover", this.hoverHandler);
		this.Root.addEventListener("pointerdown", this.pointerHandler);
		document.addEventListener("pointerdown", this.outsideHandler);
		document.addEventListener("focusin", this.outsideHandler);
		window.addEventListener("keydown", this.keyHandler);
		window.addEventListener("blur", this.blurHandler);
	}

	// Releases global listeners together with this control's local behavior.
	public Dispose(): void
	{
		this.Close(false);
		this.Root.removeEventListener("click", this.clickHandler);
		this.Root.removeEventListener("pointerover", this.hoverHandler);
		this.Root.removeEventListener("pointerdown", this.pointerHandler);
		document.removeEventListener("pointerdown", this.outsideHandler);
		document.removeEventListener("focusin", this.outsideHandler);
		window.removeEventListener("keydown", this.keyHandler);
		window.removeEventListener("blur", this.blurHandler);
	}

	// Opens one group and moves keyboard focus into its command list.
	private Open(index: number, last = false): void
	{
		if (this.openIndex < 0 && !this.Root.contains(document.activeElement))
		{
			this.previousFocus = document.activeElement as HTMLElement | null;
		}
		this.Close(false);
		const trigger = this.triggers[index];
		const menu = this.menus[index];
		if (trigger !== undefined && menu !== undefined)
		{
			this.openIndex = index;
			trigger.setAttribute("aria-expanded", "true");
			menu.hidden = false;
			const items = menu.querySelectorAll<HTMLButtonElement>("button");
			const item = last ? items[items.length - 1] : items[0];
			item?.focus();
		}
	}

	// Hides all popups before an action can open another surface.
	private Close(restoreFocus: boolean): void
	{
		for (const trigger of this.triggers)
		{
			trigger.setAttribute("aria-expanded", "false");
		}
		for (const menu of this.menus)
		{
			menu.hidden = true;
		}
		this.openIndex = -1;
		if (restoreFocus && this.previousFocus?.isConnected)
		{
			this.previousFocus.focus();
		}
	}

	// Captures the editor focus before a pointer focuses a menu trigger.
	private HandlePointerDown(): void
	{
		if (this.openIndex < 0 && !this.Root.contains(document.activeElement))
		{
			this.previousFocus = document.activeElement as HTMLElement | null;
		}
	}

	// Routes only commands owned by this menu instance.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target as Element | null;
		const command = target?.closest<HTMLButtonElement>("[data-menu-command]");
		const trigger = target?.closest<HTMLButtonElement>("[data-menu-group]");
		if (command !== null && command !== undefined)
		{
			const id = command.dataset.menuCommand!;
			this.Close(true);
			this.selected(id);
		}
		else if (trigger !== null && trigger !== undefined)
		{
			const index = Number(trigger.dataset.menuGroup);
			if (index === this.openIndex)
			{
				this.Close(false);
			}
			else
			{
				this.Open(index);
			}
		}
	}

	// Moving across the bar switches an already-open group.
	private HandleHover(event: PointerEvent): void
	{
		const target = event.target as Element | null;
		const trigger = target?.closest<HTMLButtonElement>("[data-menu-group]");
		if (this.openIndex >= 0 && trigger !== null && trigger !== undefined)
		{
			const index = Number(trigger.dataset.menuGroup);
			if (index !== this.openIndex)
			{
				this.Open(index);
			}
		}
	}

	// Dismisses menus when pointer or focus moves back to the workspace.
	private HandleOutside(event: Event): void
	{
		if (event.target instanceof Node && !this.Root.contains(event.target))
		{
			this.Close(false);
		}
	}

	// Supports standard menu activation, group traversal, item traversal, and Escape.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		if (!this.Root.hidden)
		{
			const active = document.activeElement;
			const triggerIndex = this.triggers.indexOf(active as HTMLButtonElement);
			const inside = this.Root.contains(active);
			const mnemonic = this.triggers.findIndex(function Matches(trigger): boolean
			{
				const matches = trigger.textContent?.charAt(0).toLowerCase() === event.key.toLowerCase();
				return matches;
			});
			if ((event.key === "F10" && !event.shiftKey) || (event.altKey && !event.ctrlKey && mnemonic >= 0))
			{
				event.preventDefault();
				this.previousFocus = active as HTMLElement | null;
				if (event.key === "F10")
				{
					this.triggers[0]?.focus();
				}
				else
				{
					this.Open(mnemonic);
				}
			}
			else if (inside && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
			{
				event.preventDefault();
				const current = this.openIndex >= 0 ? this.openIndex : triggerIndex;
				const step = event.key === "ArrowRight" ? 1 : -1;
				const next = (current + step + this.triggers.length) % this.triggers.length;
				if (this.openIndex >= 0)
				{
					this.Open(next);
				}
				else
				{
					this.triggers[next]?.focus();
				}
			}
			else if (inside && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
			{
				event.preventDefault();
				if (triggerIndex >= 0)
				{
					this.Open(triggerIndex, event.key === "ArrowUp" || event.key === "End");
				}
				else
				{
					const menu = this.menus[this.openIndex];
					const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? []);
					const current = items.indexOf(active as HTMLButtonElement);
					const step = event.key === "ArrowUp" ? -1 : 1;
					let next = (current + step + items.length) % items.length;
					if (event.key === "Home") next = 0;
					if (event.key === "End") next = items.length - 1;
					items[next]?.focus();
				}
			}
			else if (inside && event.key === "Escape")
			{
				event.preventDefault();
				const trigger = this.triggers[this.openIndex];
				this.Close(trigger === undefined);
				trigger?.focus();
			}
			else if (inside && event.key === "Tab")
			{
				this.Close(false);
			}
		}
	}
}
