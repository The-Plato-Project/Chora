import type { DreamSaveCoordinator } from "../dreams/DreamSaveCoordinator.js";
import type { DreamExportController } from "../dreams/DreamExportController.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { DreamTrashPanel } from "../dreams/DreamTrashPanel.js";
import type { LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import type { DreamView } from "../dreams/DreamView.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { DreamController } from "../dreams/DreamController.js";
import type { DreamStore } from "../dreams/DreamStore.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { AddIcon, CloseIcon, DocumentIcon, EditIcon, FolderAddIcon, FolderIcon, MoreIcon, SaveIcon, SearchIcon, TrashIcon } from "../ui/Icons.js";
import { PopupPanel } from "../ui/PopupPanel.js";
import { DeleteConfirmation } from "../ui/DeleteConfirmation.js";
import type { DreamFolderSnapshot } from "../../shared/dreams/DreamTypes.js";
import type { DreamExplorerController } from "./DreamExplorerController.js";

export class WorkspacePanel
{
	// Shares the standard capture and safe-message mechanism with other UI surfaces.
	private readonly errors: ErrorManager;
	private static readonly AddedWorksKey = "chora:workspace-works";
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly collapsed = new Set<string>();
	private readonly addedWorkIds = new Set<string>();
	private readonly workPicker: PopupPanel;
	private readonly dreamRenamePopup: PopupPanel;
	private readonly folderCreatePopup: PopupPanel;
	// Native modal prevents new browser edits while a disk reload is in flight.
	private reloadDialog: HTMLDialogElement | null = null;
	private readonly deleteConfirmation = new DeleteConfirmation();
	private tabOrder: string[] = [];
	private searchText = "";
	private workPickerSearchText = "";
	private renamingDreamId: string | null = null;
	private folderParentPath = "";
	// Dream identities selected through Explorer range selection.
	private readonly selectedDreamIds = new Set<string>();
	// Most recent ordinary Dream click used as the Shift-selection anchor.
	private selectionAnchorId: string | null = null;
	public constructor(
		private readonly explorerRoot: HTMLElement,
		private readonly tabsRoot: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly dreams: DreamStore,
		private readonly dreamController: DreamController,
		private readonly library: LibraryStore,
		private readonly explorer: DreamExplorerController,
		private readonly trash: DreamTrashPanel,
		private readonly saves: DreamSaveCoordinator,
		private readonly exports: DreamExportController)
	{
		this.errors = new ErrorManager(events);
		this.explorerRoot.addEventListener("click", this.HandleClick.bind(this));
		this.explorerRoot.addEventListener("input", this.HandleInput.bind(this));
		this.explorerRoot.addEventListener("dragstart", this.HandleDragStart.bind(this));
		this.explorerRoot.addEventListener("dragover", this.HandleDragOver.bind(this));
		this.explorerRoot.addEventListener("dragleave", this.HandleDragLeave.bind(this));
		this.explorerRoot.addEventListener("drop", this.HandleDropAsync.bind(this));
		this.tabsRoot.addEventListener("click", this.HandleClick.bind(this));
		this.workPicker = new PopupPanel("Add work");
		this.workPicker.OnBodyClick(this.HandleWorkPickerClick.bind(this));
		this.workPicker.OnBodyInput(this.HandleWorkPickerInput.bind(this));
		this.dreamRenamePopup = new PopupPanel("Rename Dream");
		this.dreamRenamePopup.OnBodySubmit(this.HandleDreamRenameSubmitAsync.bind(this));
		this.folderCreatePopup = new PopupPanel("New folder");
		this.folderCreatePopup.OnBodySubmit(this.HandleFolderCreateSubmitAsync.bind(this));
		this.subscriptions.push(events.Subscribe("workspace.dreams-focus-requested", this.FocusDreams.bind(this)));
		this.subscriptions.push(events.Subscribe("dream.passage-filter-changed", this.FocusSearch.bind(this)));
		this.LoadAddedWorks();
		const update = this.Update.bind(this);
		this.subscriptions.push(this.events.Subscribe("dream.opened", update));
		this.subscriptions.push(this.events.Subscribe("dream.closed", update));
		for (const eventName of ["dream.catalogue-changed", "dream.changed", "dream.saved", "dream.save-state-changed", "library.selection-changed"] as const)
		{
			this.subscriptions.push(this.events.Subscribe(eventName, update));
		}
		this.subscriptions.push(this.events.Subscribe("library.text-opened", this.HandleLibraryTextOpened.bind(this)));
		const currentWorkId = this.library.GetText()?.id;
		if (currentWorkId !== undefined) this.AddWork(currentWorkId);
		this.Update();
	}

	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		this.workPicker.Dispose();
		this.dreamRenamePopup.Dispose();
		this.folderCreatePopup.Dispose();
		this.deleteConfirmation.Dispose();
		this.reloadDialog?.remove();
	}

	// Focuses the existing catalogue search field without navigating the text.
	private FocusSearch(): void
	{
		const search = this.explorerRoot.querySelector<HTMLElement>("[data-workspace-search]");
		search?.focus();
	}

	public FocusDreams(): void
	{
		this.collapsed.delete("plato");
		this.collapsed.delete("dreams");
		this.Update();
		this.explorerRoot.querySelector<HTMLElement>('[data-workspace-toggle="dreams"]')?.focus();
	}

	private Update(): void
	{
		this.ReconcileTabOrder();
		this.ReconcileSelectedDreams();
		this.explorerRoot.innerHTML = this.RenderExplorer();
		this.tabsRoot.innerHTML = this.RenderTabs();
	}

	private RenderExplorer(): string
	{
		const workId = this.library.GetText()?.id ?? null;
		const dreams = this.RenderDreams(workId);
		let works = "";

		for (const work of this.GetAddedWorks())
		{
			const active = work.id === workId;
			const collapseKey = `work:${work.id}`;
			const expanded = active && !this.collapsed.has(collapseKey);
			const children = active ? `<div class="workspace-tree-children"${expanded ? "" : " hidden"}>${dreams}</div>` : "";
			works += `<section class="workspace-tree-work-node"><div class="workspace-tree-work-heading${active ? " selected" : ""}"><button class="workspace-work-disclosure button-control" data-workspace-toggle="${EscapeHtml(collapseKey)}" type="button" aria-label="${expanded ? "Collapse" : "Expand"} ${EscapeHtml(work.title)}" aria-expanded="${expanded}"${active ? "" : " disabled"}><span class="workspace-tree-disclosure" aria-hidden="true"></span></button><button class="workspace-tree-row workspace-tree-work button-control${active ? " selected" : ""}" data-workspace-work="${EscapeHtml(work.id)}" type="button" role="treeitem" aria-current="${active}"><span>${EscapeHtml(work.title)}</span></button></div>${children}</section>`;
		}

		const heading = `<header class="workspace-explorer-heading"><span>Explorer</span><button class="dream-icon-button button-control" data-add-work type="button" title="Add work" aria-label="Add work">${AddIcon}</button></header>`;
		const tree = `<div class="workspace-tree" data-workspace-tree role="tree" aria-label="Library workspace">${works}</div>`;

		return `<section class="workspace-explorer left-tab-panel">${heading}<label class="dream-search workspace-search">${SearchIcon}<input data-workspace-search type="search" aria-label="Filter Dreams" placeholder="Filter Dreams…" value="${EscapeHtml(this.searchText)}"></label>${tree}<footer class="workspace-library-tools"><button class="workspace-tree-row button-control" data-reload-dream-catalogue type="button">Reload from disk</button><button class="workspace-tree-row button-control" data-open-dream-trash type="button">${TrashIcon}<span>Trash</span></button></footer></section>`;
	}

	private RenderDreams(workId: string | null): string
	{
		const isCollapsed = this.collapsed.has("dreams");
		const query = this.Normalize(this.searchText);
		const document = this.library.GetText();
		const catalogue = this.dreams.GetWorkspaceCatalogue(this.searchText, document);
		let content = "";

		if (workId !== null)
		{
			const folders = this.dreams.GetFolders(workId);
			const visibleFolders = this.GetVisibleFolderPaths(folders, catalogue, query);
			content += this.RenderDreamRows(catalogue, "");
			content += this.RenderFolderChildren(workId, "", folders, visibleFolders, catalogue, 0);
		}

		if (content.length === 0) content = `<p class="workspace-tree-empty">${query.length > 0 ? "No matching Dreams." : "No Dreams yet."}</p>`;
		const selectionAvailable = this.library.GetSelection() !== null;
		const disabled = selectionAvailable ? "" : " disabled";
		const tooltip = selectionAvailable ? "New Dream from selection" : "Select a passage to create a Dream";

		return `<section class="workspace-tree-folder"><div class="workspace-tree-folder-heading workspace-folder-drop-target" data-dream-folder=""><button class="workspace-tree-row button-control" data-workspace-toggle="dreams" type="button" role="treeitem" aria-expanded="${!isCollapsed}"><span class="workspace-tree-disclosure" aria-hidden="true"></span><span class="workspace-item-icon" aria-hidden="true">${FolderIcon}</span><span>Dreams</span></button><span class="workspace-folder-actions"><button class="workspace-folder-action dream-icon-button button-control" data-new-dream-folder="" type="button" title="New folder" aria-label="New folder">${FolderAddIcon}</button><span title="${tooltip}"><button class="workspace-folder-action dream-icon-button button-control" data-new-workspace-dream type="button" aria-label="${tooltip}"${disabled}>${AddIcon}</button></span></span></div><div class="workspace-tree-children"${isCollapsed ? " hidden" : ""}>${content}</div></section>`;
	}

	// Returns folder paths that should remain visible under the current search.
	private GetVisibleFolderPaths(
		folders: readonly DreamFolderSnapshot[],
		dreams: readonly DreamView[],
		query: string): ReadonlySet<string>
	{
		const visible = new Set<string>();

		if (query.length === 0)
		{
			for (const folder of folders) visible.add(folder.path);
		}
		else
		{
			for (const folder of folders)
			{
				if (this.Normalize(folder.name).includes(query)) this.AddFolderAndAncestors(folder.path, visible);
			}
			for (const dream of dreams)
			{
				const folderPath = this.dreams.GetDreamFolder(dream.id);
				if (folderPath.length > 0) this.AddFolderAndAncestors(folderPath, visible);
			}
		}

		return visible;
	}

	// Adds one folder and every parent required to reveal it.
	private AddFolderAndAncestors(folderPath: string, paths: Set<string>): void
	{
		const segments = folderPath.split("/");

		for (let index = 1; index <= segments.length; index += 1)
		{
			const ancestor = segments.slice(0, index).join("/");
			paths.add(ancestor);
		}
	}

	// Recursively renders direct child folders beneath one parent path.
	private RenderFolderChildren(
		workId: string,
		parentPath: string,
		folders: readonly DreamFolderSnapshot[],
		visibleFolders: ReadonlySet<string>,
		dreams: readonly DreamView[],
		depth: number): string
	{
		let content = "";
		const children = folders.filter(function MatchesParent(folder): boolean
		{
			return folder.parentPath === parentPath && visibleFolders.has(folder.path);
		});
		children.sort(function CompareNames(first, second): number
		{
			return first.name.localeCompare(second.name);
		});

		for (const folder of children)
		{
			content += this.RenderFolder(workId, folder.path, folder.name, folders, visibleFolders, dreams, depth + 1);
		}

		return content;
	}

	// Renders one expandable filesystem folder and its nested contents.
	private RenderFolder(
		workId: string,
		folderPath: string,
		name: string,
		folders: readonly DreamFolderSnapshot[],
		visibleFolders: ReadonlySet<string>,
		dreams: readonly DreamView[],
		depth: number): string
	{
		const collapseKey = `folder:${folderPath}`;
		const isCollapsed = this.collapsed.has(collapseKey);
		const isSelected = this.explorer.IsFolderSelected(workId, folderPath);
		const rows = this.RenderDreamRows(dreams, folderPath);
		const children = this.RenderFolderChildren(workId, folderPath, folders, visibleFolders, dreams, depth);
		const containsFolder = folders.some(function HasChild(folder): boolean
		{
			return folder.parentPath === folderPath;
		});
		let containsDream = false;
		for (const dream of this.dreams.GetCatalogue())
		{
			const location = this.dreams.GetDreamFolder(dream.id);
			if (location === folderPath || location.startsWith(`${folderPath}/`)) containsDream = true;
		}
		const canDelete = !containsFolder && !containsDream;
		const deleteDisabled = canDelete ? "" : " disabled";
		const deleteTitle = canDelete ? `Delete ${name}` : "Folder must be empty before deletion";
		const escapedPath = EscapeHtml(folderPath);
		const style = `--workspace-depth:${depth}`;

		return `<section class="workspace-tree-folder workspace-user-folder" style="${style}"><div class="workspace-tree-folder-heading workspace-folder-drop-target${isSelected ? " selected" : ""}" data-dream-folder="${escapedPath}"><button class="workspace-work-disclosure workspace-user-folder-disclosure button-control" data-workspace-toggle="${EscapeHtml(collapseKey)}" type="button" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${EscapeHtml(name)}" aria-expanded="${!isCollapsed}"><span class="workspace-tree-disclosure" aria-hidden="true"></span></button><button class="workspace-tree-row workspace-user-folder-row button-control${isSelected ? " selected" : ""}" data-select-dream-folder="${escapedPath}" type="button" role="treeitem" aria-selected="${isSelected}"><span class="workspace-item-icon" aria-hidden="true">${FolderIcon}</span><span>${EscapeHtml(name)}</span></button><span class="workspace-folder-actions"><button class="workspace-folder-action dream-icon-button button-control" data-new-dream-folder="${escapedPath}" type="button" title="New folder inside ${EscapeHtml(name)}" aria-label="New folder inside ${EscapeHtml(name)}">${FolderAddIcon}</button><button class="workspace-folder-action dream-icon-button button-control" data-delete-dream-folder="${escapedPath}" type="button" title="${EscapeHtml(deleteTitle)}" aria-label="${EscapeHtml(deleteTitle)}"${deleteDisabled}>${TrashIcon}</button></span></div><div class="workspace-tree-children"${isCollapsed ? " hidden" : ""}>${rows}${children}</div></section>`;
	}

	// Renders Dreams placed directly within one folder.
	private RenderDreamRows(dreams: readonly DreamView[], folderPath: string): string
	{
		let rows = "";

		for (const dream of dreams)
		{
			if (this.dreams.GetDreamFolder(dream.id) === folderPath)
			{
				const isActive = this.dreams.GetActiveDream()?.id === dream.id;
				const selected = isActive || this.selectedDreamIds.has(dream.id);
				const title = dream.title || "Untitled";
				const rename = isActive ? `<button class="workspace-row-action dream-icon-button button-control" data-rename-workspace-dream="${EscapeHtml(dream.id)}" type="button" title="Rename ${EscapeHtml(title)}" aria-label="Rename ${EscapeHtml(title)}">${EditIcon}</button>` : "";
				rows += `<div class="workspace-item-with-action${selected ? " selected" : ""}" draggable="true" data-workspace-drag-dream="${EscapeHtml(dream.id)}"><button class="workspace-tree-row workspace-item-row button-control${selected ? " selected" : ""}" data-workspace-dream="${EscapeHtml(dream.id)}" type="button" role="treeitem" aria-current="${isActive}" aria-selected="${selected}"><span class="workspace-item-icon" aria-hidden="true">${DocumentIcon}</span><span>${EscapeHtml(title)} <span class="catalogue-reference">(${EscapeHtml(this.FormatSourceRange(dream))})</span></span></button>${rename}</div>`;
			}
		}

		return rows;
	}

	private RenderTabs(): string
	{
		const tabs = new Map(this.dreams.GetOpenTabs().map((tab) => [tab.dreamId, tab]));
		let items = "";

		for (const dreamId of this.tabOrder)
		{
			const tab = tabs.get(dreamId);
			if (tab === undefined) continue;
			const selected = this.dreams.GetActiveDream()?.id === tab.dreamId;
			const dirty = tab.isDirty ? `<span class="dream-document-tab-dirty" aria-label="Unsaved changes"></span>` : "";
			const escapedId = EscapeHtml(tab.dreamId);
			const escapedTitle = EscapeHtml(tab.title);
			items += `<div class="dream-document-tab${selected ? " selected" : ""}" role="presentation"><button class="dream-document-tab-label button-control" data-workspace-tab="${escapedId}" type="button" role="tab" aria-selected="${selected}" title="${escapedTitle}"><span class="dream-document-tab-icon" aria-hidden="true">${DocumentIcon}</span><span>${escapedTitle}</span></button>${dirty}<button class="dream-document-tab-close button-control" data-close-workspace-tab="${escapedId}" type="button" title="Close ${escapedTitle}" aria-label="Close ${escapedTitle}">${CloseIcon}</button></div>`;
		}

		if (items.length === 0) return "";
		return `<div class="dream-document-bar workspace-document-bar"><div class="dream-document-tabs" role="tablist" aria-label="Open Dreams">${items}</div><div class="dream-document-actions">${this.RenderDreamActions()}</div></div>`;
	}

	private RenderDreamActions(): string
	{
		const status = this.dreams.GetSaveState() === "saving" ? "Saving…" : this.dreams.GetSaveState() === "error" ? "Save failed" : this.dreams.GetIsDirty() ? "Unsaved" : "Saved";
		return `<button class="workspace-save-button button-control" data-workspace-save-dream type="button" title="Save Dream" aria-label="Save Dream"${this.dreams.GetSaveState() === "saving" ? " disabled" : ""}>Save</button><span class="dream-toolbar-status" role="status" aria-live="polite">${status}</span><details class="action-menu"><summary title="Dream actions" aria-label="Dream actions">${MoreIcon}</summary><div class="action-menu-items"><button data-workspace-save-dream type="button">${SaveIcon}Save</button><button data-workspace-close-dream type="button">${CloseIcon}Close</button><button data-workspace-delete-dream type="button">${TrashIcon}Delete</button><button data-workspace-copy-dream type="button">Copy as Markdown</button></div></details>`;
	}

	private ReconcileTabOrder(): void
	{
		const available = new Set(this.dreams.GetOpenTabs().map((tab) => tab.dreamId));
		this.tabOrder = this.tabOrder.filter((dreamId) => available.has(dreamId));

		for (const dreamId of available)
		{
			if (!this.tabOrder.includes(dreamId)) this.tabOrder.push(dreamId);
		}
	}

	private HandleLibraryTextOpened(): void
	{
		const workId = this.library.GetText()?.id;
		if (workId !== undefined) this.AddWork(workId);
		this.Update();
	}

	private HandleInput(event: Event): void
	{
		const input = event.target as HTMLInputElement | null;

		if (input?.matches("[data-workspace-search]") === true)
		{
			this.searchText = input.value;
			const previousStart = input.selectionStart;
			const previousEnd = input.selectionEnd;
			const tree = this.explorerRoot.querySelector<HTMLElement>("[data-workspace-tree]");
			if (tree !== null) tree.outerHTML = this.RenderExplorerTreeOnly();
			const current = this.explorerRoot.querySelector<HTMLInputElement>("[data-workspace-search]");
			current?.setSelectionRange(previousStart, previousEnd);
		}
	}

	private RenderExplorerTreeOnly(): string
	{
		const container = document.createElement("div");
		container.innerHTML = this.RenderExplorer();

		return container.querySelector<HTMLElement>("[data-workspace-tree]")?.outerHTML ?? "";
	}

	// Blocks editing during reconciliation and presents an actionable failure without losing drafts.
	private async ReloadCatalogueAsync(): Promise<void>
	{
		if (this.reloadDialog === null)
		{
			const dialog = document.createElement("dialog");
			this.reloadDialog = dialog;
			dialog.className = "catalogue-reload-dialog";
			dialog.addEventListener("keydown", function KeepShortcutsWithinModal(event): void { event.stopPropagation(); });
			dialog.setAttribute("aria-label", "Reload from disk");
			dialog.innerHTML = '<p role="status">Reloading Dreams, Signals, and folders…</p>';
			dialog.addEventListener("cancel", function PreventCancellation(event): void { event.preventDefault(); });
			document.body.append(dialog);
			dialog.showModal();
			try
			{
				await this.explorer.ReloadAsync();
				dialog.close();
			}
			catch (error)
			{
				const diagnostic = this.errors.Describe("Workspace.Reload", error, "Unable to reload the catalogue.");
				const message = `${diagnostic.userMessage} Diagnostic reference: ${diagnostic.id}`;
				dialog.innerHTML = `<p role="alert">${EscapeHtml(message)}</p><p>Reload has stopped. Resolve the issue, then choose Reload from disk again. Unsaved edits have not been discarded.</p><button class="button-control" type="button">Close</button>`;
				const close = dialog.querySelector<HTMLButtonElement>("button");
				close?.addEventListener("click", function CloseFailure(): void { dialog.close(); });
				close?.focus();
				await new Promise<void>(function WaitForClose(resolve): void
				{
					dialog.addEventListener("close", function Complete(): void { resolve(); }, { once: true });
				});
			}
			finally
			{
				dialog.remove();
				this.reloadDialog = null;
				const trigger = this.explorerRoot.querySelector<HTMLElement>("[data-reload-dream-catalogue]");
				trigger?.focus();
			}
		}
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const workId = target?.closest<HTMLElement>("[data-workspace-work]")?.dataset.workspaceWork;

		const trashButton = target?.closest<HTMLElement>("[data-open-dream-trash]");

		const reloadButton = target?.closest<HTMLElement>("[data-reload-dream-catalogue]");

		if (reloadButton !== null && reloadButton !== undefined)
		{
			void this.ReloadCatalogueAsync();
		}
		else if (trashButton !== null && trashButton !== undefined)
		{
			void this.trash.OpenAsync(trashButton);
		}
		else if (workId !== undefined)
		{
			if (workId !== this.library.GetText()?.id) void this.events.PublishAsync("library.text-open-requested", { textId: workId });
		}
		else if (target?.closest("[data-add-work]") !== null)
		{
			this.OpenWorkPicker();
		}
		else
		{
			const newFolder = target?.closest<HTMLElement>("[data-new-dream-folder]");
			const deleteFolder = target?.closest<HTMLElement>("[data-delete-dream-folder]");
			const selectFolder = target?.closest<HTMLElement>("[data-select-dream-folder]");
			const toggle = target?.closest<HTMLElement>("[data-workspace-toggle]")?.dataset.workspaceToggle;
			const dreamId = target?.closest<HTMLElement>("[data-workspace-dream]")?.dataset.workspaceDream;
			const renameId = target?.closest<HTMLElement>("[data-rename-workspace-dream]")?.dataset.renameWorkspaceDream;
			const tabId = target?.closest<HTMLElement>("[data-workspace-tab]")?.dataset.workspaceTab;
			const closeId = target?.closest<HTMLElement>("[data-close-workspace-tab]")?.dataset.closeWorkspaceTab;

			if (newFolder !== null && newFolder !== undefined)
			{
				this.OpenFolderCreatePopup(newFolder.dataset.newDreamFolder ?? "");
			}
			else if (deleteFolder !== null && deleteFolder !== undefined)
			{
				const folderPath = deleteFolder.dataset.deleteDreamFolder ?? "";
				this.explorer.SelectFolder(folderPath);
				this.selectedDreamIds.clear();
				this.selectionAnchorId = null;
				this.ConfirmFolderDelete(folderPath, deleteFolder);
			}
			else if (selectFolder !== null && selectFolder !== undefined)
			{
				this.explorer.SelectFolder(selectFolder.dataset.selectDreamFolder ?? "");
				this.selectedDreamIds.clear();
				this.selectionAnchorId = null;
				this.Update();
			}
			else if (toggle !== undefined)
			{
				if (this.collapsed.has(toggle)) this.collapsed.delete(toggle);
				else this.collapsed.add(toggle);
				this.Update();
			}
			else if (dreamId !== undefined)
			{
				if (event instanceof MouseEvent && event.shiftKey)
				{
					this.SelectDreamRange(dreamId);
					this.Update();
				}
				else
				{
					this.explorer.ClearFolderSelection();
					this.selectedDreamIds.clear();
					this.selectionAnchorId = dreamId;
					this.dreamController.Open(dreamId);
				}
			}
			else if (target?.closest("[data-new-workspace-dream]") !== null)
			{
				const selection = this.library.GetSelection();
				if (selection !== null) void this.explorer.CreateDreamAsync(selection);
			}
			else if (renameId !== undefined)
			{
				this.OpenDreamRenamePopup(renameId);
			}
			else if (tabId !== undefined)
			{
				this.dreamController.ActivateTab(tabId);
			}
			else if (closeId !== undefined)
			{
				void this.CloseTabAsync(closeId);
			}
			else if (target?.closest("[data-workspace-save-dream]") !== null)
			{
				void this.saves.SaveAsync();
			}
			else if (target?.closest("[data-workspace-close-dream]") !== null)
			{
				void this.CloseActiveDreamAsync();
			}
			else if (target?.closest("[data-workspace-copy-dream]") !== null)
			{
				void this.exports.CopyDreamAsMarkdownAsync();
			}
			else
			{
				const deleteTrigger = target?.closest<HTMLElement>("[data-workspace-delete-dream]") ?? null;
				if (deleteTrigger !== null) this.ConfirmDreamDelete(deleteTrigger);
			}
		}
	}

	// Opens the folder-name form for one parent path.
	private OpenFolderCreatePopup(parentPath: string): void
	{
		this.folderParentPath = parentPath;
		this.folderCreatePopup.SetBodyHtml(`<form class="dream-rename-form" data-dream-folder-create-form><label class="dream-field dream-settings-title"><span>Folder Name</span><input data-dream-folder-name placeholder="New folder"></label><p class="dream-rename-error" data-dream-folder-create-error role="alert" hidden>Unable to create this folder.</p><div class="dream-rename-actions"><button class="button-control" data-dream-folder-create-save type="submit">Create</button></div></form>`);
		this.folderCreatePopup.Open();
		const input = document.querySelector<HTMLInputElement>('.popup-overlay:not([hidden]) [data-dream-folder-name]');
		input?.focus();
	}

	// Creates one folder from the popup form and leaves failures visible for correction.
	private async HandleFolderCreateSubmitAsync(event: Event): Promise<void>
	{
		const form = event.target instanceof HTMLFormElement && event.target.matches("[data-dream-folder-create-form]") ? event.target : null;

		if (form !== null)
		{
			event.preventDefault();
			const input = form.querySelector<HTMLInputElement>("[data-dream-folder-name]");
			const button = form.querySelector<HTMLButtonElement>("[data-dream-folder-create-save]");
			const error = form.querySelector<HTMLElement>("[data-dream-folder-create-error]");

			if (input !== null && button !== null && error !== null)
			{
				const name = input.value.trim();
				input.value = name;
				button.disabled = true;
				error.hidden = true;
				const created = await this.explorer.CreateFolderAsync(this.folderParentPath, name);

				if (created)
				{
					this.collapsed.delete(`folder:${this.folderParentPath}`);
					this.folderCreatePopup.Close();
				}
				else
				{
					button.disabled = false;
					error.hidden = false;
					input.focus();
				}
			}
		}
	}

	// Confirms and deletes one folder only when it is empty.
	private ConfirmFolderDelete(folderPath: string, trigger: HTMLElement): void
	{
		const workId = this.library.GetText()?.id ?? "";
		const folder = this.dreams.GetFolders(workId).find(function MatchesPath(candidate): boolean
		{
			return candidate.path === folderPath;
		});

		if (folder !== undefined)
		{
			this.deleteConfirmation.Open(
				"Folder",
				folder.name,
				"Only empty folders can be deleted. Dreams are never deleted with a folder.",
				trigger,
				this.DeleteFolderFromConfirmationAsync.bind(this, folderPath));
		}
	}

	// Performs one confirmed folder deletion.
	private async DeleteFolderFromConfirmationAsync(folderPath: string): Promise<boolean>
	{
		const deleted = await this.explorer.DeleteFolderAsync(folderPath);

		return deleted;
	}

	// Begins dragging one Dream Explorer item.
	private HandleDragStart(event: DragEvent): void
	{
		const target = event.target as HTMLElement | null;
		const dreamId = target?.closest<HTMLElement>("[data-workspace-drag-dream]")?.dataset.workspaceDragDream;

		if (dreamId !== undefined && event.dataTransfer !== null)
		{
			const dreamIds = this.selectedDreamIds.has(dreamId) && this.selectedDreamIds.size > 1
				? [...this.selectedDreamIds]
				: [dreamId];
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("application/x-chora-dreams", dreamIds.join("\n"));
			event.dataTransfer.setData("text/plain", dreamId);
		}
	}

	// Marks a folder as an available Dream drop destination.
	private HandleDragOver(event: DragEvent): void
	{
		const target = event.target as HTMLElement | null;
		const folder = target?.closest<HTMLElement>("[data-dream-folder]");

		if (folder !== null && folder !== undefined && event.dataTransfer !== null)
		{
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			this.ClearFolderDropTargets();
			folder.classList.add("drop-target");
		}
	}

	// Removes transient drop highlighting after leaving a folder.
	private HandleDragLeave(event: DragEvent): void
	{
		const target = event.target as HTMLElement | null;
		const folder = target?.closest<HTMLElement>("[data-dream-folder]");
		const related = event.relatedTarget as Node | null;

		if (folder !== null && folder !== undefined && (related === null || !folder.contains(related)))
		{
			folder.classList.remove("drop-target");
		}
	}

	// Moves a dropped Dream through the canonical Dream folder API.
	private async HandleDropAsync(event: DragEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const folder = target?.closest<HTMLElement>("[data-dream-folder]");

		if (folder !== null && folder !== undefined && event.dataTransfer !== null)
		{
			event.preventDefault();
			const serializedDreamIds = event.dataTransfer.getData("application/x-chora-dreams");
			const dreamIds = this.ParseDraggedDreamIds(serializedDreamIds);
			const folderPath = folder.dataset.dreamFolder ?? "";
			this.ClearFolderDropTargets();

			if (dreamIds.length > 0)
			{
				await this.explorer.MoveDreamsAsync(dreamIds, folderPath);
			}
		}
	}

	// Parses the private Dream drag payload without trusting arbitrary page data.
	private ParseDraggedDreamIds(serializedDreamIds: string): string[]
	{
		const dreamIds: string[] = [];
		const catalogue = this.dreams.GetCatalogue();

		for (const candidate of serializedDreamIds.split("\n"))
		{
			if (candidate.length > 0 && catalogue.some(function MatchesDream(dream): boolean
			{
				return dream.id === candidate;
			}))
			{
				dreamIds.push(candidate);
			}
		}

		return dreamIds;
	}

	// Clears drop feedback from every folder row.
	private ClearFolderDropTargets(): void
	{
		const targets = this.explorerRoot.querySelectorAll<HTMLElement>(".workspace-folder-drop-target.drop-target");

		for (let index = 0; index < targets.length; index += 1)
		{
			targets.item(index).classList.remove("drop-target");
		}
	}

	// Selects the contiguous visible Dream range from the established anchor.
	private SelectDreamRange(dreamId: string): void
	{
		const dreamRows = this.explorerRoot.querySelectorAll<HTMLElement>("[data-workspace-dream]");
		const orderedIds: string[] = [];

		for (let index = 0; index < dreamRows.length; index += 1)
		{
			const candidate = dreamRows.item(index).dataset.workspaceDream;
			if (candidate !== undefined) orderedIds.push(candidate);
		}

		const anchorId = this.selectionAnchorId ?? dreamId;
		const anchorIndex = orderedIds.indexOf(anchorId);
		const targetIndex = orderedIds.indexOf(dreamId);
		this.selectedDreamIds.clear();

		if (anchorIndex >= 0 && targetIndex >= 0)
		{
			const start = Math.min(anchorIndex, targetIndex);
			const end = Math.max(anchorIndex, targetIndex);

			for (let index = start; index <= end; index += 1)
			{
				const selectedId = orderedIds[index];
				if (selectedId !== undefined) this.selectedDreamIds.add(selectedId);
			}
		}
		else
		{
			this.selectedDreamIds.add(dreamId);
		}
	}

	// Removes selections for Dreams no longer present in the catalogue.
	private ReconcileSelectedDreams(): void
	{
		const available = new Set<string>();

		for (const dream of this.dreams.GetCatalogue()) available.add(dream.id);
		for (const dreamId of this.selectedDreamIds)
		{
			if (!available.has(dreamId)) this.selectedDreamIds.delete(dreamId);
		}
		if (this.selectionAnchorId !== null && !available.has(this.selectionAnchorId)) this.selectionAnchorId = null;

	}

	private async CloseTabAsync(dreamId: string): Promise<void>
	{
		await this.dreamController.CloseTabAsync(dreamId);
		this.SelectAvailableDocument();
	}

	private async CloseActiveDreamAsync(): Promise<void>
	{
		await this.dreamController.CloseAsync();
		this.SelectAvailableDocument();
	}

	private SelectAvailableDocument(): void
	{
		this.Update();
	}

	private ConfirmDreamDelete(trigger: HTMLElement): void
	{
		const dream = this.dreams.GetActiveDream();

		if (dream !== null)
		{
			this.deleteConfirmation.Open(
				"Dream",
				dream.title,
				"The Dream and its Signals will stay in Trash until you restore or permanently delete them.",
				trigger,
				async (): Promise<boolean> =>
				{
					const deleted = await this.dreamController.DeleteAsync();
					if (deleted) this.SelectAvailableDocument();

					return deleted;
				});
		}
	}

	private OpenDreamRenamePopup(dreamId: string): void
	{
		const dream = this.dreams.GetCatalogue().find((candidate) => candidate.id === dreamId);
		if (dream !== undefined)
		{
			this.renamingDreamId = dreamId;
			this.dreamController.Open(dreamId);
			this.dreamRenamePopup.SetBodyHtml(`<form class="dream-rename-form" data-workspace-dream-rename-form><label class="dream-field dream-settings-title"><span>Dream Name</span><input data-workspace-dream-title value="${EscapeHtml(dream.title)}" placeholder="Untitled Dream"></label><p class="dream-rename-error" data-workspace-dream-rename-error role="alert" hidden>Unable to save the Dream. Your new name has not been saved.</p><div class="dream-rename-actions"><button class="button-control" data-workspace-dream-rename-save type="submit">Save</button></div></form>`);
			this.dreamRenamePopup.Open();
			const input = document.querySelector<HTMLInputElement>('.popup-overlay:not([hidden]) [data-workspace-dream-title]');
			input?.focus();
			input?.select();
		}
	}

	private async HandleDreamRenameSubmitAsync(event: Event): Promise<void>
	{
		const form = event.target instanceof HTMLFormElement && event.target.matches("[data-workspace-dream-rename-form]") ? event.target : null;
		if (form !== null && this.renamingDreamId !== null)
		{
			event.preventDefault();
			const input = form.querySelector<HTMLInputElement>("[data-workspace-dream-title]");
			const button = form.querySelector<HTMLButtonElement>("[data-workspace-dream-rename-save]");
			const error = form.querySelector<HTMLElement>("[data-workspace-dream-rename-error]");

			if (input !== null && button !== null && error !== null)
			{
				const title = input.value.trim();
				input.value = title;
				button.disabled = true;
				error.hidden = true;
				this.dreamController.Open(this.renamingDreamId);
				this.dreamController.UpdateTitle(title);
				await this.saves.SaveAsync();

				if (this.dreams.GetSaveState() === "error")
				{
					button.disabled = false;
					error.hidden = false;
					input.focus();
				}
				else
				{
					this.renamingDreamId = null;
					this.dreamRenamePopup.Close();
				}
			}
		}
	}

	private OpenWorkPicker(): void
	{
		this.workPickerSearchText = "";
		this.workPicker.SetBodyHtml(`<label class="application-find work-picker-search">${SearchIcon}<input data-work-picker-search type="search" aria-label="Filter available works" placeholder="Filter works…"></label><div class="work-picker-list" data-work-picker-list>${this.RenderAvailableWorks()}</div>`);
		this.workPicker.Open();
		document.querySelector<HTMLInputElement>("[data-work-picker-search]")?.focus();
	}

	private RenderAvailableWorks(): string
	{
		const query = this.Normalize(this.workPickerSearchText);
		let rows = "";

		for (const work of this.library.GetSnapshot().texts)
		{
			if (work.author !== "Plato" || this.addedWorkIds.has(work.id)) continue;
			if (query.length > 0 && !this.Normalize(`${work.title} ${work.titleGreek ?? ""}`).includes(query)) continue;
			const greekTitle = work.titleGreek === null ? "" : `<span class="work-picker-secondary">${EscapeHtml(work.titleGreek)}</span>`;
			rows += `<button class="work-picker-item button-control" data-add-library-work="${EscapeHtml(work.id)}" type="button"><span>${EscapeHtml(work.title)}</span>${greekTitle}</button>`;
		}

		if (rows.length === 0) rows = `<p class="workspace-tree-empty">${query.length > 0 ? "No matching works." : "All available works have been added."}</p>`;

		return rows;
	}

	private HandleWorkPickerClick(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const workId = target?.closest<HTMLElement>("[data-add-library-work]")?.dataset.addLibraryWork;

		if (workId !== undefined)
		{
			this.AddWork(workId);
			this.workPicker.Close();
			this.Update();
			void this.events.PublishAsync("library.text-open-requested", { textId: workId });
		}
	}

	private HandleWorkPickerInput(event: Event): void
	{
		const input = event.target as HTMLInputElement | null;

		if (input?.matches("[data-work-picker-search]") === true)
		{
			this.workPickerSearchText = input.value;
			this.workPicker.SetSectionHtml("[data-work-picker-list]", this.RenderAvailableWorks());
		}
	}

	private GetAddedWorks(): LibraryTextSummary[]
	{
		const snapshot = this.library.GetSnapshot();
		const works = snapshot.texts.filter((work) => this.addedWorkIds.has(work.id));

		if (snapshot.text !== null && !works.some((work) => work.id === snapshot.text?.id))
		{
			works.push({
				id: snapshot.text.id,
				urn: snapshot.text.urn,
				title: snapshot.text.title,
				titleGreek: snapshot.text.titleGreek,
				author: snapshot.text.author,
				language: snapshot.text.language,
				editor: snapshot.text.edition.editor,
				fileName: snapshot.text.provenance.sourceFile
			});
		}

		return works;
	}

	private LoadAddedWorks(): void
	{
		const stored = window.localStorage.getItem(WorkspacePanel.AddedWorksKey) ?? "";

		for (const workId of stored.split(","))
		{
			const trimmed = workId.trim();
			if (trimmed.length > 0) this.addedWorkIds.add(trimmed);
		}
	}

	private AddWork(workId: string): void
	{
		if (!this.addedWorkIds.has(workId))
		{
			this.addedWorkIds.add(workId);
			window.localStorage.setItem(WorkspacePanel.AddedWorksKey, Array.from(this.addedWorkIds).join(","));
		}
	}

	private Normalize(value: string): string
	{
		return value.trim().toLocaleLowerCase();
	}

	private FormatSourceRange(dream: DreamView): string
	{
		const document = this.library.GetText();
		const start = document?.id === dream.workId ? document.ResolveCitation(dream.source.start)?.value : undefined;
		const end = document?.id === dream.workId ? document.ResolveCitation(dream.source.end)?.value : undefined;

		if (start !== undefined && end !== undefined && start !== end) return `${start}–${end}`;

		return start ?? end ?? "source";
	}

}
