// One immutable row in a selectable application list.
export interface ListViewItem
{
	// Stable identity independent of row position or text.
	readonly Id: string;
	// Primary label.
	readonly Text: string;
	// Optional compact secondary column.
	readonly Detail?: string;
	// Language of the primary label.
	readonly Language?: string;
	// Prevents selection of an unavailable row.
	readonly Disabled?: boolean;
	// Optional trusted application badge such as a count or indicator icon.
	readonly BadgeHtml?: string;
	// Feature-owned data attributes for delegated context actions.
	readonly Data?: Readonly<Record<string, string>>;
}

// Owns keyed list rows, single selection, and accessible keyboard navigation.
export class ListViewControl
{
	// Persistent list root.
	public readonly Root = document.createElement("div");
	// Current immutable presentation rows.
	private items: readonly ListViewItem[] = [];
	// Persistent row nodes keyed by identity.
	private readonly rows = new Map<string, HTMLButtonElement>();
	// Local UI selection; domain state remains with the owning feature.
	private selectedId: string | null = null;
	// Stable delegated listeners.
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly keyHandler = this.HandleKeyDown.bind(this);

	// Creates a list without coupling its selection to a feature action.
	public constructor(label: string, private readonly selectionChanged: (id: string | null) => void | Promise<void>,
		private readonly activateSelected = false)
	{
		this.Root.className = "control-list";
		this.Root.setAttribute("role", "listbox");
		this.Root.setAttribute("aria-label", label);
		this.Root.addEventListener("click", this.clickHandler);
		this.Root.addEventListener("keydown", this.keyHandler);
	}

	// Reads the selected row identity without retaining a separate domain record.
	public get SelectedId(): string | null
	{
		return this.selectedId;
	}

	// Reconciles rows without replacing retained buttons or stealing focus.
	public SetItems(items: readonly ListViewItem[]): void
	{
		const ids = new Set<string>();
		for (const item of items)
		{
			if (ids.has(item.Id))
			{
				throw new Error("List row identities must be unique.");
			}
			ids.add(item.Id);
		}
		this.items = items;
		for (const [id, row] of this.rows)
		{
			if (!ids.has(id))
			{
				row.remove();
				this.rows.delete(id);
			}
		}
		let position = this.Root.firstElementChild;
		for (const item of items)
		{
			let row = this.rows.get(item.Id);
			if (row === undefined)
			{
				row = document.createElement("button");
				row.type = "button";
				row.className = "control-list-row button-control";
				row.dataset.listId = item.Id;
				row.setAttribute("role", "option");
				const primary = document.createElement("span");
				primary.className = "control-list-primary";
				const text = document.createElement("span");
				text.className = "control-list-text";
				const badge = document.createElement("span");
				badge.className = "control-list-badge";
				primary.append(text, badge);
				const detail = document.createElement("span");
				detail.className = "control-list-detail";
				row.append(primary, detail);
				this.rows.set(item.Id, row);
			}
			const primary = row.firstElementChild as HTMLElement;
			const text = primary.firstElementChild as HTMLElement;
			const detail = row.lastElementChild as HTMLElement;
			if (text.textContent !== item.Text)
			{
				text.textContent = item.Text;
			}
			this.SetBadge(item.Id, item.BadgeHtml ?? "");
			for (const key of Object.keys(row.dataset))
			{
				if (key !== "listId" && item.Data?.[key] === undefined)
				{
					delete row.dataset[key];
				}
			}
			for (const [key, value] of Object.entries(item.Data ?? {}))
			{
				row.dataset[key] = value;
			}
			primary.lang = item.Language ?? "";
			const detailText = item.Detail ?? "";
			if (detail.textContent !== detailText)
			{
				detail.textContent = detailText;
			}
			detail.hidden = detailText.length === 0;
			row.disabled = item.Disabled ?? false;
			row.title = detailText.length === 0 ? item.Text : `${item.Text} · ${detailText}`;
			if (row !== position)
			{
				this.Root.insertBefore(row, position);
			}
			position = row.nextElementSibling;
		}
		if (this.selectedId !== null && (!ids.has(this.selectedId) || this.rows.get(this.selectedId)?.disabled))
		{
			this.selectedId = null;
			void this.selectionChanged(null);
		}
		this.UpdateSelection();
	}

	// Reflects feature-selected state without invoking the feature again.
	public Select(id: string | null): void
	{
		const row = id === null ? undefined : this.rows.get(id);
		this.selectedId = row !== undefined && !row.disabled ? id : null;
		this.UpdateSelection();
	}

	// Patches a derived row indicator without rebuilding the list or changing selection.
	public SetBadge(id: string, html: string): void
	{
		const badge = this.rows.get(id)?.querySelector<HTMLElement>(".control-list-badge");
		if (badge !== null && badge !== undefined && badge.innerHTML !== html)
		{
			badge.innerHTML = html;
		}
	}

	// Releases delegated listeners and row resources.
	public Dispose(): void
	{
		this.Root.removeEventListener("click", this.clickHandler);
		this.Root.removeEventListener("keydown", this.keyHandler);
		this.rows.clear();
		this.items = [];
		this.Root.remove();
	}

	// Translates a clicked row into a local selection change.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target instanceof Element ? event.target : null;
		const row = target?.closest<HTMLButtonElement>("[data-list-id]");
		const action = target?.closest("[data-list-action]");
		if (action === null && row !== null && row !== undefined && this.Root.contains(row) && !row.disabled)
		{
			this.Choose(row.dataset.listId!);
		}
	}

	// Supports arrows, Home/End, and explicit keyboard selection.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const available: ListViewItem[] = [];
		for (const item of this.items)
		{
			if (!item.Disabled)
			{
				available.push(item);
			}
		}
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-list-id]") : null;
		const focusedId = target?.dataset.listId ?? this.selectedId;
		let index = available.findIndex(function Matches(item): boolean
		{
			const matches = item.Id === focusedId;
			return matches;
		});
		let handled = true;
		if (event.key === "ArrowDown")
		{
			index = Math.min(index + 1, available.length - 1);
		}
		else if (event.key === "ArrowUp")
		{
			index = Math.max(index - 1, 0);
		}
		else if (event.key === "Home")
		{
			index = 0;
		}
		else if (event.key === "End")
		{
			index = available.length - 1;
		}
		else if (event.key !== " " && event.key !== "Enter")
		{
			handled = false;
		}
		const item = available[index];
		if (handled && item !== undefined)
		{
			event.preventDefault();
			this.Choose(item.Id);
			this.rows.get(item.Id)?.focus();
		}
	}

	// Publishes selection only after a deliberate reader interaction.
	private Choose(id: string): void
	{
		if (id !== this.selectedId || this.activateSelected)
		{
			this.selectedId = id;
			this.UpdateSelection();
			void this.selectionChanged(id);
		}
	}

	// Keeps selected presentation and one keyboard tab stop in agreement.
	private UpdateSelection(): void
	{
		const first = this.items.find(function Available(item): boolean
		{
			const available = !item.Disabled;
			return available;
		});
		const tabStopId = this.selectedId ?? first?.Id;
		for (const [id, row] of this.rows)
		{
			const selected = id === this.selectedId;
			row.classList.toggle("selected", selected);
			row.setAttribute("aria-selected", String(selected));
			const tabStop = !row.disabled && id === tabStopId;
			row.tabIndex = tabStop ? 0 : -1;
		}
	}
}
