import type { LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import type { VisionFolderSnapshot, VisionSnapshot } from "../../shared/visions/VisionTypes.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { AddIcon, DocumentIcon, FolderAddIcon, FolderIcon, SearchIcon, TrashIcon } from "../ui/Icons.js";
import { DialogControl } from "../ui/controls/DialogControl.js";
import { ListViewControl, type ListViewItem } from "../ui/controls/ListViewControl.js";
import { TreeControl, type TreeAction, type TreeItem } from "../ui/controls/TreeControl.js";
import type { VisionController } from "../visions/VisionController.js";
import type { VisionStore } from "../visions/VisionStore.js";

// Feature command context for a generic Explorer tree item.
interface WorkspaceItem
{
	// Type of feature navigation or folder operation.
	readonly Kind: "work" | "visions" | "folder" | "vision";
	// Canonical owning work.
	readonly WorkId: string;
	// Current folder path, validated by the main process on mutation.
	readonly FolderPath: string;
	// Document identity for a Vision leaf.
	readonly VisionId?: string;
}

// Owns Explorer projections and commands; shared controls own tree, list, and dialog behavior.
export class WorkspacePanel
{
	// Persisted work membership for the Explorer.
	private static readonly AddedWorksKey = "chora:workspace-works";
	// Released application subscriptions.
	private readonly subscriptions: Unsubscribe[] = [];
	// Reader-selected works displayed by this workspace.
	private readonly addedWorkIds = new Set<string>();
	// Lightweight routing context for current tree items.
	private readonly contexts = new Map<string, WorkspaceItem>();
	// Standard accessible Explorer tree.
	private readonly tree: TreeControl;
	// Standard work chooser and form/confirmation dialogs.
	private readonly workDialog: DialogControl;
	private readonly folderDialog: DialogControl;
	private readonly deleteDialog: DialogControl;
	// Work rows remain selectable until OK commits a choice.
	private readonly workList: ListViewControl;
	// Persistent chooser content and search field.
	private readonly workContent = document.createElement("div");
	private readonly workSearch = document.createElement("input");
	// Persistent Explorer search field.
	private readonly search: HTMLInputElement;
	// Current text restriction for the tree projection.
	private searchText = "";
	// Captured folder-creation context, independent of later work activation.
	private folderWorkId: string | null = null;
	private folderParentPath = "";
	// Delegated host listeners retained for disposal.
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly inputHandler = this.HandleInput.bind(this);
	private readonly workInputHandler = this.UpdateWorkList.bind(this);

	// Composes reusable controls with the existing feature stores and workflow owner.
	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly library: LibraryStore,
		private readonly visions: VisionStore,
		private readonly controller: VisionController)
	{
		const errors = new ErrorManager(events);
		this.workDialog = new DialogControl(errors);
		this.folderDialog = new DialogControl(errors);
		this.deleteDialog = new DialogControl(errors);
		this.workList = new ListViewControl("Available works", this.HandleWorkSelected.bind(this));
		this.tree = new TreeControl({
			Label: "Library workspace",
			Invoked: this.HandleTreeInvoked.bind(this),
			ActionInvoked: this.HandleTreeAction.bind(this),
			DragType: "application/x-chora-vision",
			Dropped: this.HandleTreeDropAsync.bind(this)
		});
		this.root.innerHTML = `<section class="workspace-explorer"><header class="workspace-explorer-heading"><span>Explorer</span><button class="control-icon-button button-control" data-add-work type="button" title="Add work" aria-label="Add work">${AddIcon}</button></header><label class="control-search">${SearchIcon}<input data-workspace-search type="search" aria-label="Filter Visions" placeholder="Filter Visions…"></label><div data-workspace-tree-host></div></section>`;
		this.search = this.root.querySelector<HTMLInputElement>("[data-workspace-search]")!;
		this.root.querySelector("[data-workspace-tree-host]")!.append(this.tree.Root);
		const workLabel = document.createElement("label");
		workLabel.className = "control-search";
		workLabel.innerHTML = SearchIcon;
		this.workSearch.type = "search";
		this.workSearch.dataset.workPickerSearch = "";
		this.workSearch.setAttribute("aria-label", "Filter works");
		workLabel.append(this.workSearch);
		this.workContent.append(workLabel, this.workList.Root);
		this.workSearch.addEventListener("input", this.workInputHandler);
		this.root.addEventListener("click", this.clickHandler);
		this.root.addEventListener("input", this.inputHandler);
		this.subscriptions.push(events.Subscribe("vision.catalogue-changed", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.metadata-changed", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.opened", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.closed", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("library.text-opened", this.HandleTextOpened.bind(this)));
		this.LoadAddedWorks();
		const workId = library.GetText()?.id;
		if (workId !== undefined)
		{
			this.AddWork(workId);
		}
		this.Update();
	}

	// Releases all owned controls and listeners.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
		this.root.removeEventListener("click", this.clickHandler);
		this.root.removeEventListener("input", this.inputHandler);
		this.workSearch.removeEventListener("input", this.workInputHandler);
		this.tree.Dispose();
		this.workList.Dispose();
		this.workDialog.Dispose();
		this.folderDialog.Dispose();
		this.deleteDialog.Dispose();
	}

	// Projects domain data into shared tree items without replacing the Explorer shell.
	private Update(): void
	{
		this.contexts.clear();
		const currentWorkId = this.library.GetText()?.id;
		const items: TreeItem[] = [];
		for (const work of this.GetAddedWorks())
		{
			const id = `work:${work.id}`;
			const active = work.id === currentWorkId;
			this.contexts.set(id, { Kind: "work", WorkId: work.id, FolderPath: "" });
			const item: TreeItem = {
				Id: id, Text: work.title, Selected: active,
				Data: { workspaceWork: work.id },
				...(active ? { Children: [this.BuildVisions(work.id)], Expanded: true } : {})
			};
			items.push(item);
		}
		this.tree.SetItems(items);
	}

	// Builds the Vision root and filtered hierarchy while retaining empty real folders.
	private BuildVisions(workId: string): TreeItem
	{
		const query = this.Normalize(this.searchText);
		const folders = this.visions.GetFolders(workId);
		const visions: VisionSnapshot[] = [];
		const visible = new Set<string>();
		for (const vision of this.visions.GetCatalogue(workId))
		{
			const title = this.Normalize(vision.title);
			if (query.length === 0 || title.includes(query))
			{
				visions.push(vision);
				this.AddAncestors(vision.folderPath, visible);
			}
		}
		for (const folder of folders)
		{
			const name = this.Normalize(folder.name);
			if (query.length === 0 || name.includes(query))
			{
				this.AddAncestors(folder.path, visible);
			}
		}
		const id = `visions:${workId}`;
		this.contexts.set(id, { Kind: "visions", WorkId: workId, FolderPath: "" });
		const children = this.BuildFolderItems(workId, "", folders, visible, visions);
		const item: TreeItem = {
			Id: id, Text: "Visions", Icon: FolderIcon, Children: children,
			Actions: this.FolderActions(false), AcceptsDrop: true,
			EmptyText: query.length === 0 ? "No Visions yet." : "No matching Visions."
		};
		return item;
	}

	// Recursively projects folders and document leaves beneath one real directory.
	private BuildFolderItems(workId: string, parentPath: string, folders: readonly VisionFolderSnapshot[], visible: ReadonlySet<string>, visions: readonly VisionSnapshot[]): readonly TreeItem[]
	{
		const items: TreeItem[] = [];
		const activeId = this.visions.GetActive()?.id;
		for (const vision of visions)
		{
			if (vision.folderPath === parentPath)
			{
				const id = `vision:${vision.id}`;
				this.contexts.set(id, { Kind: "vision", WorkId: workId, FolderPath: parentPath, VisionId: vision.id });
				items.push({ Id: id, Text: vision.title || "Untitled Vision", Icon: DocumentIcon, Selected: vision.id === activeId,
					Draggable: true, Data: { workspaceVision: vision.id } });
			}
		}
		const children: VisionFolderSnapshot[] = [];
		for (const folder of folders)
		{
			if (folder.parentPath === parentPath && visible.has(folder.path))
			{
				children.push(folder);
			}
		}
		children.sort(function Compare(first, second): number
		{
			const order = first.name.localeCompare(second.name);
			return order;
		});
		for (const folder of children)
		{
			const id = `folder:${workId}:${folder.path}`;
			this.contexts.set(id, { Kind: "folder", WorkId: workId, FolderPath: folder.path });
			const descendants = this.BuildFolderItems(workId, folder.path, folders, visible, visions);
			const emptyText = this.searchText.trim().length === 0 ? "This folder is empty." : "No matching items.";
			items.push({ Id: id, Text: folder.name, Icon: FolderIcon, Children: descendants,
				Actions: this.FolderActions(true), AcceptsDrop: true, EmptyText: emptyText });
		}
		return items;
	}

	// Supplies shared inline actions, with deletion available only for real folders.
	private FolderActions(canDelete: boolean): readonly TreeAction[]
	{
		const actions: TreeAction[] = [
			{ Id: "new-folder", Label: "New folder", Icon: FolderAddIcon },
			{ Id: "new-vision", Label: "New Vision", Icon: AddIcon }
		];
		if (canDelete)
		{
			actions.push({ Id: "delete-folder", Label: "Delete folder", Icon: TrashIcon });
		}
		return actions;
	}

	// Keeps parent folders visible when a matching descendant is found.
	private AddAncestors(path: string, visible: Set<string>): void
	{
		const parts = path.split("/");
		for (let length = 1; length <= parts.length; length += 1)
		{
			const ancestor = parts.slice(0, length).join("/");
			visible.add(ancestor);
		}
	}

	// Routes feature navigation; container disclosure remains inside TreeControl.
	private HandleTreeInvoked(id: string): void
	{
		const item = this.contexts.get(id);
		if (item?.Kind === "work")
		{
			void this.events.PublishAsync("library.text-open-requested", { textId: item.WorkId });
		}
		else if (item?.VisionId !== undefined)
		{
			this.controller.Open(item.VisionId);
		}
	}

	// Routes explicit row actions using the captured item context.
	private HandleTreeAction(id: string, action: string, trigger: HTMLElement): void
	{
		const item = this.contexts.get(id);
		if (item !== undefined)
		{
			if (action === "new-vision")
			{
				void this.controller.CreateAsync(item.WorkId, item.FolderPath);
			}
			else if (action === "new-folder")
			{
				this.folderWorkId = item.WorkId;
				this.folderParentPath = item.FolderPath;
				this.folderDialog.Open({ Title: "New folder", Trigger: trigger,
					Content: '<label class="control-field"><span>Name</span><input data-folder-name maxlength="80" required></label>',
					InitialFocus: "[data-folder-name]", CommitAsync: this.CommitFolderAsync.bind(this),
					FailureMessage: "The folder could not be created. Check its name and try again." });
			}
			else if (action === "delete-folder")
			{
				this.OpenDeleteFolder(item, trigger);
			}
		}
	}

	// Commits a valid folder draft only through OK or form submission.
	private async CommitFolderAsync(): Promise<boolean>
	{
		const input = this.folderDialog.Content.querySelector<HTMLInputElement>("[data-folder-name]");
		const name = input?.value.trim() ?? "";
		let created = false;
		if (name.length > 0 && this.folderWorkId !== null)
		{
			created = await this.controller.CreateFolderAsync(this.folderWorkId, this.folderParentPath, name);
		}
		return created;
	}

	// Confirms a folder operation through the generic Cancel/OK contract.
	private OpenDeleteFolder(item: WorkspaceItem, trigger: HTMLElement): void
	{
		const name = item.FolderPath.split("/").pop() ?? item.FolderPath;
		const owner = this;
		async function DeleteFolderAsync(): Promise<boolean>
		{
			const deleted = await owner.controller.DeleteFolderAsync(item.WorkId, item.FolderPath);
			return deleted;
		}
		this.deleteDialog.Open({ Title: "Delete Folder?", Trigger: trigger,
			Content: `<p>Delete <strong>${EscapeHtml(name)}</strong>?</p><p>The folder must be empty.</p>`,
			CommitAsync: DeleteFolderAsync, FailureMessage: "The folder could not be deleted. It must be empty." });
	}

	// Maps a generic tree drop into the existing validated move workflow.
	private async HandleTreeDropAsync(sourceId: string, targetId: string): Promise<void>
	{
		const source = this.contexts.get(sourceId);
		const target = this.contexts.get(targetId);
		if (source?.VisionId !== undefined && target !== undefined && source.WorkId === target.WorkId)
		{
			await this.controller.MoveAsync(source.VisionId, target.FolderPath);
		}
	}

	// Opens work selection without opening or adding the selected row yet.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target instanceof Element ? event.target : null;
		if (target !== null && target.closest("[data-add-work]") !== null)
		{
			this.workSearch.value = "";
			this.workList.Select(null);
			this.UpdateWorkList();
			this.workDialog.Open({ Title: "Add work", Content: this.workContent, CanCommit: false,
				InitialFocus: this.workSearch, CommitAsync: this.CommitWorkAsync.bind(this),
				FailureMessage: "The selected work could not be opened." });
		}
	}

	// Filters only tree rows, preserving the search caret and focus.
	private HandleInput(event: Event): void
	{
		if (event.target === this.search)
		{
			this.searchText = this.search.value;
			this.Update();
		}
	}

	// Refreshes the shared list while retaining the chooser search field.
	private UpdateWorkList(): void
	{
		const query = this.Normalize(this.workSearch.value);
		const items: ListViewItem[] = [];
		for (const work of this.library.GetSnapshot().texts)
		{
			const title = this.Normalize(work.title);
			if (!this.addedWorkIds.has(work.id) && (query.length === 0 || title.includes(query)))
			{
				items.push({ Id: work.id, Text: work.title });
			}
		}
		this.workList.SetItems(items);
	}

	// Selection changes only OK availability, never the requested application action.
	private HandleWorkSelected(id: string | null): void
	{
		this.workDialog.SetCanCommit(id !== null);
	}

	// Opens the chosen work only after the dialog's explicit commit.
	private async CommitWorkAsync(): Promise<boolean>
	{
		const workId = this.workList.SelectedId;
		let opened = false;
		if (workId !== null)
		{
			await this.events.PublishAsync("library.text-open-requested", { textId: workId });
			opened = this.library.GetText()?.id === workId;
		}
		return opened;
	}

	// Adds successfully opened works to the reader's Explorer membership.
	private HandleTextOpened(): void
	{
		const workId = this.library.GetText()?.id;
		if (workId !== undefined)
		{
			this.AddWork(workId);
		}
		this.Update();
	}

	// Reads the ordered canonical works selected for this workspace.
	private GetAddedWorks(): readonly LibraryTextSummary[]
	{
		const works: LibraryTextSummary[] = [];
		for (const work of this.library.GetSnapshot().texts)
		{
			if (this.addedWorkIds.has(work.id))
			{
				works.push(work);
			}
		}
		return works;
	}

	// Persists reader-selected work membership without storing document data.
	private AddWork(workId: string): void
	{
		this.addedWorkIds.add(workId);
		try
		{
			const membership = JSON.stringify([...this.addedWorkIds]);
			window.localStorage.setItem(WorkspacePanel.AddedWorksKey, membership);
		}
		catch
		{
			// Membership remains usable for this session when local storage is unavailable.
		}
	}

	// Restores valid membership identities and ignores malformed session preferences.
	private LoadAddedWorks(): void
	{
		try
		{
			const stored = window.localStorage.getItem(WorkspacePanel.AddedWorksKey);
			const ids: unknown = stored === null ? [] : JSON.parse(stored);
			if (Array.isArray(ids))
			{
				for (const id of ids)
				{
					if (typeof id === "string")
					{
						this.addedWorkIds.add(id);
					}
				}
			}
		}
		catch
		{
			this.addedWorkIds.clear();
		}
	}

	// Normalizes only reader-facing search text.
	private Normalize(value: string): string
	{
		const normalized = value.trim().toLocaleLowerCase();
		return normalized;
	}
}
