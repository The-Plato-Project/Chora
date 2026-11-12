// One inline action belonging to a tree row.
export interface TreeAction
{
	// Feature-defined action identity.
	readonly Id: string;
	// Accessible action name.
	readonly Label: string;
	// Trusted application icon markup.
	readonly Icon: string;
}

// Immutable presentation of a hierarchical navigation item.
export interface TreeItem
{
	// Stable identity, independent of its label or position.
	readonly Id: string;
	// Reader-facing row label.
	readonly Text: string;
	// Optional trusted application icon.
	readonly Icon?: string;
	// Nested items; an empty array still represents an expandable container.
	readonly Children?: readonly TreeItem[];
	// Initial expansion state when this item becomes expandable.
	readonly Expanded?: boolean;
	// Current feature-selected item.
	readonly Selected?: boolean;
	// Optional row actions.
	readonly Actions?: readonly TreeAction[];
	// Feature data used by existing context actions without exposing domain state to the control.
	readonly Data?: Readonly<Record<string, string>>;
	// Allows this item to be dragged.
	readonly Draggable?: boolean;
	// Allows this container to receive a dragged item.
	readonly AcceptsDrop?: boolean;
	// Empty-container feedback.
	readonly EmptyText?: string;
}

// Feature callbacks; the tree owns interactions, never persistence or navigation workflows.
export interface TreeControlOptions
{
	// Accessible tree name.
	readonly Label: string;
	// Invokes the selected navigation item.
	readonly Invoked: (id: string) => void;
	// Invokes an explicit inline action.
	readonly ActionInvoked: (id: string, actionId: string, trigger: HTMLElement) => void;
	// MIME type shared by compatible drag sources and drop targets.
	readonly DragType?: string;
	// Requests a feature-owned move operation.
	readonly Dropped?: (sourceId: string, targetId: string) => void | Promise<void>;
}

// Mounted row and branch elements retained across feature updates.
interface TreeRow
{
	// Container including its nested group.
	readonly Root: HTMLElement;
	// Row layout containing disclosure, label, and actions.
	readonly Heading: HTMLElement;
	// Expand/collapse button.
	readonly Toggle: HTMLButtonElement;
	// Accessible tree item and keyboard focus target.
	readonly Label: HTMLButtonElement;
	// Stable icon slot.
	readonly Icon: HTMLElement;
	// Stable label slot.
	readonly Text: HTMLElement;
	// Inline row actions.
	readonly Actions: HTMLElement;
	// Nested item group.
	readonly Group: HTMLElement;
}

// Owns persistent tree rows, disclosure, roving focus, keyboard navigation, and drag/drop.
export class TreeControl
{
	// Allocates accessible branch identities across independent controls.
	private static nextGroupId = 0;
	// Stable accessible tree root.
	public readonly Root = document.createElement("div");
	// Current presentation hierarchy.
	private items: readonly TreeItem[] = [];
	// Current items indexed for interaction lookup.
	private readonly byId = new Map<string, TreeItem>();
	// Parent identities for keyboard navigation.
	private readonly parents = new Map<string, string>();
	// Persistent DOM resources for each identity.
	private readonly rows = new Map<string, TreeRow>();
	// Local expansion state, independent of feature domain data.
	private readonly expanded = new Map<string, boolean>();
	// Delegated root listeners, all released on disposal.
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	// Keeps action-button focus associated with its owning tree row.
	private readonly focusHandler = this.HandleFocus.bind(this);
	private readonly dragStartHandler = this.HandleDragStart.bind(this);
	private readonly dragOverHandler = this.HandleDragOver.bind(this);
	private readonly dragLeaveHandler = this.HandleDragLeave.bind(this);
	private readonly dropHandler = this.HandleDrop.bind(this);

	// Creates one reusable tree without assigning any feature meaning to its items.
	public constructor(private readonly options: TreeControlOptions)
	{
		this.Root.className = "control-tree";
		this.Root.setAttribute("role", "tree");
		this.Root.setAttribute("aria-label", options.Label);
		this.Root.addEventListener("click", this.clickHandler);
		this.Root.addEventListener("keydown", this.keyHandler);
		this.Root.addEventListener("focusin", this.focusHandler);
		this.Root.addEventListener("dragstart", this.dragStartHandler);
		this.Root.addEventListener("dragover", this.dragOverHandler);
		this.Root.addEventListener("dragleave", this.dragLeaveHandler);
		this.Root.addEventListener("drop", this.dropHandler);
	}

	// Reconciles a hierarchy while preserving row DOM, expansion, focus, and scroll.
	public SetItems(items: readonly TreeItem[]): void
	{
		this.items = items;
		this.byId.clear();
		this.parents.clear();
		this.Reconcile(this.Root, items, null, 1);
		for (const [id, row] of this.rows)
		{
			if (!this.byId.has(id))
			{
				row.Root.remove();
				this.rows.delete(id);
			}
		}
		this.UpdateTabStops();
	}

	// Releases owned DOM and all interaction listeners.
	public Dispose(): void
	{
		this.Root.removeEventListener("click", this.clickHandler);
		this.Root.removeEventListener("keydown", this.keyHandler);
		this.Root.removeEventListener("focusin", this.focusHandler);
		this.Root.removeEventListener("dragstart", this.dragStartHandler);
		this.Root.removeEventListener("dragover", this.dragOverHandler);
		this.Root.removeEventListener("dragleave", this.dragLeaveHandler);
		this.Root.removeEventListener("drop", this.dropHandler);
		this.rows.clear();
		this.byId.clear();
		this.parents.clear();
		this.expanded.clear();
		this.Root.remove();
	}

	// Patches one sibling collection and recursively mounts its current children.
	private Reconcile(host: HTMLElement, items: readonly TreeItem[], parentId: string | null, depth: number): void
	{
		let position = host.firstElementChild;
		for (const item of items)
		{
			if (this.byId.has(item.Id))
			{
				throw new Error("Tree item identities must be unique.");
			}
			this.byId.set(item.Id, item);
			if (parentId !== null)
			{
				this.parents.set(item.Id, parentId);
			}
			let row = this.rows.get(item.Id);
			if (row === undefined)
			{
				row = this.CreateRow(item.Id);
				this.rows.set(item.Id, row);
			}
			if (row.Root !== position)
			{
				host.insertBefore(row.Root, position);
			}
			position = row.Root.nextElementSibling;
			const branch = item.Children !== undefined;
			if (branch && !this.expanded.has(item.Id))
			{
				this.expanded.set(item.Id, item.Expanded ?? true);
			}
			const open = branch && this.expanded.get(item.Id) === true;
			row.Root.style.setProperty("--tree-depth", String(depth - 1));
			row.Toggle.hidden = !branch;
			row.Toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${item.Text}`);
			row.Toggle.setAttribute("aria-expanded", String(open));
			row.Label.setAttribute("aria-level", String(depth));
			row.Label.setAttribute("aria-selected", String(item.Selected ?? false));
			row.Heading.classList.toggle("selected", item.Selected ?? false);
			if (branch)
			{
				row.Label.setAttribute("aria-expanded", String(open));
				row.Label.setAttribute("aria-owns", row.Group.id);
			}
			else
			{
				row.Label.removeAttribute("aria-expanded");
				row.Label.removeAttribute("aria-owns");
			}
			if (row.Text.textContent !== item.Text)
			{
				row.Text.textContent = item.Text;
			}
			const icon = item.Icon ?? "";
			if (row.Icon.innerHTML !== icon)
			{
				row.Icon.innerHTML = icon;
			}
			for (const key of Object.keys(row.Label.dataset))
			{
				if (key !== "treeId" && item.Data?.[key] === undefined)
				{
					delete row.Label.dataset[key];
				}
			}
			for (const [key, value] of Object.entries(item.Data ?? {}))
			{
				row.Label.dataset[key] = value;
			}
			row.Label.draggable = item.Draggable ?? false;
			if (item.AcceptsDrop)
			{
				row.Root.dataset.treeDrop = item.Id;
			}
			else
			{
				delete row.Root.dataset.treeDrop;
			}
			this.ReconcileActions(row.Actions, item.Actions ?? []);
			row.Group.hidden = !open;
			this.Reconcile(row.Group, item.Children ?? [], item.Id, depth + 1);
			const empty = row.Group.querySelector<HTMLElement>(":scope > .control-empty");
			if (item.Children?.length === 0 && item.EmptyText !== undefined)
			{
				const message = empty ?? document.createElement("p");
				message.className = "control-empty";
				message.textContent = item.EmptyText;
				if (empty === null)
				{
					row.Group.append(message);
				}
			}
			else
			{
				empty?.remove();
			}
		}
	}

	// Creates a row's shared structure only once.
	private CreateRow(id: string): TreeRow
	{
		const root = document.createElement("section");
		root.className = "control-tree-node";
		root.setAttribute("role", "none");
		const heading = document.createElement("div");
		heading.className = "control-tree-row";
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "control-tree-toggle button-control";
		toggle.dataset.treeToggle = id;
		toggle.tabIndex = -1;
		const label = document.createElement("button");
		label.type = "button";
		label.className = "control-tree-label button-control";
		label.dataset.treeId = id;
		label.setAttribute("role", "treeitem");
		const icon = document.createElement("span");
		icon.className = "control-tree-icon";
		icon.setAttribute("aria-hidden", "true");
		const text = document.createElement("span");
		text.className = "control-tree-text";
		label.append(icon, text);
		const actions = document.createElement("span");
		actions.className = "control-tree-actions";
		const group = document.createElement("div");
		TreeControl.nextGroupId += 1;
		group.id = `tree-group-${TreeControl.nextGroupId}`;
		group.className = "control-tree-group";
		group.setAttribute("role", "group");
		heading.append(toggle, label, actions);
		root.append(heading, group);
		const row: TreeRow = { Root: root, Heading: heading, Toggle: toggle, Label: label, Icon: icon, Text: text, Actions: actions, Group: group };
		return row;
	}

	// Retains action buttons when labels or feature selection change.
	private ReconcileActions(host: HTMLElement, actions: readonly TreeAction[]): void
	{
		const live = new Set<string>();
		for (const action of actions)
		{
			live.add(action.Id);
			let button = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-tree-action]")).find(function Matches(candidate): boolean
			{
				const matches = candidate.dataset.treeAction === action.Id;
				return matches;
			});
			if (button === undefined)
			{
				button = document.createElement("button");
				button.type = "button";
				button.className = "control-icon-button button-control";
				button.dataset.treeAction = action.Id;
				button.innerHTML = action.Icon;
				host.append(button);
			}
			button.title = action.Label;
			button.setAttribute("aria-label", action.Label);
		}
		for (const button of Array.from(host.querySelectorAll<HTMLButtonElement>("[data-tree-action]")))
		{
			if (!live.has(button.dataset.treeAction!))
			{
				button.remove();
			}
		}
	}

	// Routes row clicks, disclosure clicks, and inline actions separately.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target instanceof Element ? event.target : null;
		const toggleId = target?.closest<HTMLElement>("[data-tree-toggle]")?.dataset.treeToggle;
		const action = target?.closest<HTMLButtonElement>("[data-tree-action]");
		const label = target?.closest<HTMLElement>("[data-tree-id]");
		if (toggleId !== undefined)
		{
			this.Toggle(toggleId);
			this.rows.get(toggleId)?.Label.focus();
		}
		else if (action !== null && action !== undefined)
		{
			const id = action.closest(".control-tree-row")?.querySelector<HTMLElement>("[data-tree-id]")?.dataset.treeId;
			if (id !== undefined)
			{
				this.options.ActionInvoked(id, action.dataset.treeAction!, action);
			}
		}
		else if (label?.dataset.treeId !== undefined)
		{
			const item = this.byId.get(label.dataset.treeId);
			if (item?.Children !== undefined)
			{
				this.Toggle(item.Id);
			}
			this.options.Invoked(label.dataset.treeId);
		}
	}

	// Toggles only this branch, preserving all other DOM and focus.
	private Toggle(id: string): void
	{
		this.expanded.set(id, !this.expanded.get(id));
		this.SetItems(this.items);
	}

	// Computes visible navigation order independently of collapsed descendants.
	private VisibleItems(items = this.items): readonly TreeItem[]
	{
		const visible: TreeItem[] = [];
		for (const item of items)
		{
			visible.push(item);
			if (item.Children !== undefined && this.expanded.get(item.Id))
			{
				const children = this.VisibleItems(item.Children);
				visible.push(...children);
			}
		}
		return visible;
	}

	// Implements standard tree arrows, Home/End, and explicit invocation.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-id]") : null;
		const id = target?.dataset.treeId;
		if (id !== undefined)
		{
			const visible = this.VisibleItems();
			const index = visible.findIndex(function Matches(item): boolean
			{
				const matches = item.Id === id;
				return matches;
			});
			let nextId: string | undefined;
			if (event.key === "ArrowDown")
			{
				nextId = visible[Math.min(index + 1, visible.length - 1)]?.Id;
			}
			else if (event.key === "ArrowUp")
			{
				nextId = visible[Math.max(index - 1, 0)]?.Id;
			}
			else if (event.key === "Home")
			{
				nextId = visible[0]?.Id;
			}
			else if (event.key === "End")
			{
				nextId = visible[visible.length - 1]?.Id;
			}
			else if (event.key === "ArrowRight")
			{
				const item = this.byId.get(id);
				if (item?.Children !== undefined && !this.expanded.get(id))
				{
					this.Toggle(id);
				}
				else
				{
					nextId = item?.Children?.[0]?.Id;
				}
			}
			else if (event.key === "ArrowLeft")
			{
				if (this.byId.get(id)?.Children !== undefined && this.expanded.get(id))
				{
					this.Toggle(id);
				}
				else
				{
					nextId = this.parents.get(id);
				}
			}
			if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
			{
				event.preventDefault();
				if (nextId !== undefined)
				{
					this.rows.get(nextId)?.Label.focus();
					this.UpdateTabStops(nextId);
				}
			}
		}
	}

	// Keeps the focused or selected visible item as the single row tab stop.
	private UpdateTabStops(focusedId?: string): void
	{
		const visible = this.VisibleItems();
		const focused = focusedId ?? (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.treeId : undefined);
		const preferred = visible.find(function Preferred(item): boolean
		{
			const matches = focused === undefined ? item.Selected === true : item.Id === focused;
			return matches;
		});
		const currentId = preferred?.Id ?? visible[0]?.Id;
		for (const [id, row] of this.rows)
		{
			row.Label.tabIndex = id === currentId ? 0 : -1;
			for (const action of Array.from(row.Actions.querySelectorAll<HTMLButtonElement>("button")))
			{
				action.tabIndex = id === currentId ? 0 : -1;
			}
		}
	}

	// Associates focus in row actions with the same row's roving tab stop.
	private HandleFocus(event: FocusEvent): void
	{
		const target = event.target instanceof Element ? event.target : null;
		const heading = target?.closest(".control-tree-row");
		const id = heading?.querySelector<HTMLElement>("[data-tree-id]")?.dataset.treeId;
		if (id !== undefined)
		{
			this.UpdateTabStops(id);
		}
	}

	// Starts a compatible drag without interpreting its domain identity.
	private HandleDragStart(event: DragEvent): void
	{
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-id]") : null;
		const id = target?.dataset.treeId;
		if (id !== undefined && this.byId.get(id)?.Draggable && this.options.DragType !== undefined && event.dataTransfer !== null)
		{
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData(this.options.DragType, id);
		}
	}

	// Highlights only compatible container targets.
	private HandleDragOver(event: DragEvent): void
	{
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-drop]") : null;
		if (target !== null && this.options.DragType !== undefined && event.dataTransfer?.types.includes(this.options.DragType))
		{
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			target.classList.add("drop-target");
		}
	}

	// Clears a target highlight when the pointer leaves its subtree.
	private HandleDragLeave(event: DragEvent): void
	{
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-drop]") : null;
		if (target !== null && !target.contains(event.relatedTarget as Node | null))
		{
			target.classList.remove("drop-target");
		}
	}

	// Requests the feature-owned move only after a compatible explicit drop.
	private HandleDrop(event: DragEvent): void
	{
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-drop]") : null;
		const type = this.options.DragType;
		const sourceId = type === undefined ? "" : event.dataTransfer?.getData(type) ?? "";
		if (target !== null && sourceId.length > 0)
		{
			event.preventDefault();
			target.classList.remove("drop-target");
			void this.options.Dropped?.(sourceId, target.dataset.treeDrop!);
		}
	}
}
