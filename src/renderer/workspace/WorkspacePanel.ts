import type { DreamView } from "../dreams/DreamView.js";
import type { IdeaRecord, IdeaSignalReference } from "../../shared/ideas/IdeaTypes.js";
import type { LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { DreamController } from "../dreams/DreamController.js";
import type { DreamStore } from "../dreams/DreamStore.js";
import type { IdeaController } from "../ideas/IdeaController.js";
import type { IdeaStore } from "../ideas/IdeaStore.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { AddIcon, CloseIcon, DocumentIcon, EditIcon, IdeaIcon, MoreIcon, PreviousIcon, SaveIcon, SearchIcon, TrashIcon } from "../ui/Icons.js";
import { PopupPanel } from "../ui/PopupPanel.js";
import { DeleteConfirmation } from "../ui/DeleteConfirmation.js";

type WorkspaceDocumentKind = "dream" | "idea";

interface WorkspaceTabReference
{
	readonly kind: WorkspaceDocumentKind;
	readonly key: string;
}

export class WorkspacePanel
{
	private static readonly AddedWorksKey = "chora:workspace-works";
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly collapsed = new Set<string>();
	private readonly addedWorkIds = new Set<string>();
	private readonly workPicker: PopupPanel;
	private readonly ideaPicker: PopupPanel;
	private readonly dreamRenamePopup: PopupPanel;
	// Prompts for a persistence decision before an unsaved Idea is closed.
	private readonly unsavedIdeaPopup: PopupPanel;
	private readonly deleteConfirmation = new DeleteConfirmation();
	private tabOrder: WorkspaceTabReference[] = [];
	private searchText = "";
	private workPickerSearchText = "";
	private activeKind: WorkspaceDocumentKind | null = null;
	private renamingDreamId: string | null = null;
	// Identifies the unsaved Idea tab awaiting a close decision.
	private pendingUnsavedIdeaKey: string | null = null;
	private canReturnToIdea = false;
	private isAddingSignalToIdea = false;
	// Handles Signal drag targeting within the Ideas tree.
	private readonly dragOverHandler = this.HandleDragOver.bind(this);
	// Clears Signal drop-target presentation.
	private readonly dragLeaveHandler = this.HandleDragLeave.bind(this);
	// Associates a dropped Signal with an existing or new Idea.
	private readonly dropHandler = this.HandleDropAsync.bind(this);

	public constructor(
		private readonly explorerRoot: HTMLElement,
		private readonly tabsRoot: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly dreams: DreamStore,
		private readonly dreamController: DreamController,
		private readonly ideas: IdeaStore,
		private readonly ideaController: IdeaController,
		private readonly library: LibraryStore)
	{
		this.explorerRoot.addEventListener("click", this.HandleClick.bind(this));
		this.explorerRoot.addEventListener("input", this.HandleInput.bind(this));
		this.explorerRoot.addEventListener("dragover", this.dragOverHandler);
		this.explorerRoot.addEventListener("dragleave", this.dragLeaveHandler);
		this.explorerRoot.addEventListener("drop", this.dropHandler);
		this.tabsRoot.addEventListener("click", this.HandleClick.bind(this));
		this.workPicker = new PopupPanel("Add work");
		this.workPicker.OnBodyClick(this.HandleWorkPickerClick.bind(this));
		this.workPicker.OnBodyInput(this.HandleWorkPickerInput.bind(this));
		this.ideaPicker = new PopupPanel("Add Signal to Idea");
		this.ideaPicker.OnBodyClick(this.HandleIdeaPickerClickAsync.bind(this));
		this.ideaPicker.OnClose(this.HandleIdeaPickerClosed.bind(this));
		this.dreamRenamePopup = new PopupPanel("Rename Dream");
		this.dreamRenamePopup.OnBodySubmit(this.HandleDreamRenameSubmitAsync.bind(this));
		this.unsavedIdeaPopup = new PopupPanel("Save Idea?");
		this.unsavedIdeaPopup.OnBodyClick(this.HandleUnsavedIdeaClickAsync.bind(this));
		this.unsavedIdeaPopup.OnClose(this.HandleUnsavedIdeaPopupClosed.bind(this));
		this.LoadAddedWorks();
		this.isAddingSignalToIdea = this.ideas.GetPendingAddReference() !== null;
		const update = this.Update.bind(this);
		this.subscriptions.push(this.events.Subscribe("dream.opened", this.HandleDreamOpened.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.closed", this.HandleDreamClosed.bind(this)));
		this.subscriptions.push(this.events.Subscribe("idea.open-requested", this.HandleIdeaOpenRequestedAsync.bind(this)));
		this.subscriptions.push(this.events.Subscribe("workspace.document-selected", this.HandleDocumentSelected.bind(this)));
		this.subscriptions.push(this.events.Subscribe("ideas.changed", this.HandleIdeasChanged.bind(this)));
		for (const eventName of ["dream.catalogue-changed", "dream.changed", "dream.saved", "dream.save-state-changed", "idea.draft-changed", "library.selection-changed"] as const)
		{
			this.subscriptions.push(this.events.Subscribe(eventName, update));
		}
		this.subscriptions.push(this.events.Subscribe("library.text-opened", this.HandleLibraryTextOpened.bind(this)));
		const currentWorkId = this.library.GetText()?.id;
		if (currentWorkId !== undefined) this.AddWork(currentWorkId);
		if (this.dreams.GetActiveDream() !== null) this.activeKind = "dream";
		else if (this.ideas.GetDraft() !== null) this.activeKind = "idea";
		this.Update();
	}

	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		this.workPicker.Dispose();
		this.ideaPicker.Dispose();
		this.dreamRenamePopup.Dispose();
		this.unsavedIdeaPopup.Dispose();
		this.deleteConfirmation.Dispose();
		this.explorerRoot.removeEventListener("dragover", this.dragOverHandler);
		this.explorerRoot.removeEventListener("dragleave", this.dragLeaveHandler);
		this.explorerRoot.removeEventListener("drop", this.dropHandler);
	}

	public ActivateIdeaDocument(): void
	{
		if (this.ideas.GetDraft() !== null)
		{
			this.activeKind = "idea";
			this.Update();
			void this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
		}
	}

	public SetIdeaReturnAvailable(isAvailable: boolean): void
	{
		this.canReturnToIdea = isAvailable;
		this.RefreshTabs();
	}

	private Update(): void
	{
		this.ReconcileTabOrder();
		this.explorerRoot.innerHTML = this.RenderExplorer();
		this.RefreshTabs();
	}

	// Reveals and focuses one Explorer folder after the collapsed rail is expanded.
	public FocusExplorerSection(kind: "dream" | "idea"): void
	{
		const key = kind === "dream" ? "dreams" : "ideas";
		this.collapsed.delete("plato");
		this.collapsed.delete(key);
		this.Update();
		this.explorerRoot.querySelector<HTMLElement>(`[data-workspace-toggle="${key}"]`)?.focus();
	}

	private RenderExplorer(): string
	{
		const text = this.library.GetText();
		const workId = text?.id ?? this.ideas.GetWorkId();
		const ideas = this.RenderIdeas(workId);
		const dreams = this.RenderDreams(workId);
		let works = "";
		for (const work of this.GetAddedWorks())
		{
			const active = work.id === workId;
			const collapseKey = `work:${work.id}`;
			const expanded = active && !this.collapsed.has(collapseKey);
			const children = active ? `<div class="workspace-tree-children"${expanded ? "" : " hidden"}>${ideas}${dreams}</div>` : "";
			works += `<section class="workspace-tree-work-node"><div class="workspace-tree-work-heading${active ? " selected" : ""}"><button class="workspace-work-disclosure button-control" data-workspace-toggle="${EscapeHtml(collapseKey)}" type="button" aria-label="${expanded ? "Collapse" : "Expand"} ${EscapeHtml(work.title)}" aria-expanded="${expanded}"${active ? "" : " disabled"}><span class="workspace-tree-disclosure" aria-hidden="true"></span></button><button class="workspace-tree-row workspace-tree-work button-control${active ? " selected" : ""}" data-workspace-work="${EscapeHtml(work.id)}" type="button" role="treeitem" aria-current="${active}"><span>${EscapeHtml(work.title)}</span></button></div>${children}</section>`;
		}
		const addWork = `<button class="workspace-tree-row workspace-add-work button-control" data-add-work type="button">${AddIcon}<span>Add work&hellip;</span></button>`;
		const tree = `<div class="workspace-tree" data-workspace-tree role="tree" aria-label="Plato workspace"><section class="workspace-tree-node"><button class="workspace-tree-row workspace-tree-root button-control" data-workspace-toggle="plato" type="button" role="treeitem" aria-expanded="${!this.collapsed.has("plato")}"><span class="workspace-tree-disclosure" aria-hidden="true"></span><strong>Plato</strong></button><div class="workspace-tree-children"${this.collapsed.has("plato") ? " hidden" : ""}>${works}${addWork}</div></section></div>`;
		return `<section class="workspace-explorer left-tab-panel"><label class="dream-search workspace-search">${SearchIcon}<input data-workspace-search type="search" aria-label="Filter Ideas and Dreams" placeholder="Filter Ideas and Dreams…" value="${EscapeHtml(this.searchText)}"></label>${tree}</section>`;
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

	private RenderIdeas(workId: string | null): string
	{
		const isCollapsed = this.collapsed.has("ideas");
		const query = this.Normalize(this.searchText);
		const pendingReference = this.ideas.GetPendingAddReference();
		const pending = pendingReference !== null;
		let rows = "";
		for (const idea of this.ideas.GetIdeas())
		{
			if (workId !== null && idea.workId !== workId) continue;
			if (!this.MatchesIdea(idea, query)) continue;
			const selected = this.activeKind === "idea" && this.ideas.GetDraft()?.ideaId === idea.id;
			const connected = pendingReference !== null && this.ContainsSignal(idea, pendingReference);
			const disabled = connected ? ' disabled title="Already connected to this Idea"' : "";
			rows += `<button class="workspace-tree-row workspace-item-row button-control${selected ? " selected" : ""}" data-workspace-idea="${EscapeHtml(idea.id)}" type="button" role="treeitem" aria-current="${selected}"${disabled}><span class="workspace-item-icon" aria-hidden="true">${IdeaIcon}</span><span>${EscapeHtml(idea.title || "Untitled Idea")}</span></button>`;
		}
		if (rows.length === 0) rows = `<p class="workspace-tree-empty">${query.length > 0 ? "No matching Ideas." : "No Ideas yet."}</p>`;
		const plusLabel = pending ? "Create Idea from Signal" : "New Idea";
		return `<section class="workspace-tree-folder"><div class="workspace-tree-folder-heading"><button class="workspace-tree-row button-control" data-workspace-toggle="ideas" type="button" role="treeitem" aria-expanded="${!isCollapsed}"><span class="workspace-tree-disclosure" aria-hidden="true"></span><span>Ideas</span></button><button class="workspace-folder-action dream-icon-button button-control" data-new-workspace-idea type="button" title="${plusLabel}" aria-label="${plusLabel}">${AddIcon}</button></div><div class="workspace-tree-children"${isCollapsed ? " hidden" : ""}>${rows}</div></section>`;
	}

	private HandleIdeasChanged(): void
	{
		const isAdding = this.ideas.GetPendingAddReference() !== null;
		const startedAdding = isAdding && !this.isAddingSignalToIdea;
		const stoppedAdding = !isAdding && this.isAddingSignalToIdea;
		this.isAddingSignalToIdea = isAdding;
		if (startedAdding)
		{
			const workId = this.library.GetText()?.id ?? this.ideas.GetWorkId();
			this.searchText = "";
			this.collapsed.delete("plato");
			this.collapsed.delete("ideas");
			if (workId !== null) this.collapsed.delete(`work:${workId}`);
		}
		this.Update();
		if (startedAdding)
		{
			this.OpenIdeaPicker();
		}
		else if (stoppedAdding && this.ideaPicker.IsOpen)
		{
			this.ideaPicker.Close();
		}
	}

	// Opens an explicit chooser for one pending Signal association.
	private OpenIdeaPicker(): void
	{
		let rows = "";

		for (const idea of this.ideas.GetIdeas())
		{
			const pending = this.ideas.GetPendingAddReference();
			const connected = pending !== null && this.ContainsSignal(idea, pending);
			const disabled = connected ? " disabled" : "";
			const label = idea.title || "Untitled Idea";
			rows += `<button class="idea-picker-item button-control" data-picker-idea="${EscapeHtml(idea.id)}" type="button"${disabled}>${IdeaIcon}<span>${EscapeHtml(label)}</span></button>`;
		}

		if (rows.length === 0) rows = `<p class="idea-picker-empty">No saved Ideas yet.</p>`;
		const markup = `<div class="idea-picker-actions"><button class="idea-picker-new button-control" data-picker-new-idea type="button">${AddIcon}<span>Create new Idea</span></button></div><div class="idea-picker-list" role="list">${rows}</div>`;
		this.ideaPicker.SetBodyHtml(markup);
		this.ideaPicker.Open();
		const target = document.querySelector<HTMLButtonElement>("[data-picker-idea]:not(:disabled)")
			?? document.querySelector<HTMLButtonElement>("[data-picker-new-idea]");
		target?.focus();
	}

	// Applies the pending Signal to one chosen existing or new Idea.
	private async HandleIdeaPickerClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const ideaId = target?.closest<HTMLElement>("[data-picker-idea]")?.dataset.pickerIdea;
		const createsIdea = target?.closest("[data-picker-new-idea]") !== null;

		if (ideaId !== undefined)
		{
			await this.ideaController.AddPendingSignalToIdeaAsync(ideaId);
			this.ideaPicker.Close();
		}
		else if (createsIdea)
		{
			const saved = await this.ideaController.CreateIdeaFromPendingSignalAsync();
			this.ActivateIdeaDocument();

			if (saved)
			{
				this.ideaPicker.Close();
			}
		}
	}

	// Cancels a pending association when the chooser is dismissed.
	private HandleIdeaPickerClosed(): void
	{
		if (this.ideas.GetPendingAddReference() !== null)
		{
			this.ideaController.CancelAddToIdea();
		}
	}

	private RenderDreams(workId: string | null): string
	{
		const isCollapsed = this.collapsed.has("dreams");
		const query = this.Normalize(this.searchText);
		const groups = new Map<string, DreamView[]>();
		const document = this.library.GetText();
		const catalogue = this.dreams.GetWorkspaceCatalogue(this.searchText, document);
		for (const dream of catalogue)
		{
			if (workId !== null && dream.workId !== workId) continue;
			const division = document?.id === dream.workId
				? document.ResolveDivision(dream.source.start)
				: null;
			const book = division?.type === "book" ? division.label : "Other";
			const group = groups.get(book) ?? [];
			group.push(dream);
			groups.set(book, group);
		}
		let books = "";
		for (const [book, dreams] of groups)
		{
			const key = `book:${book}`;
			const collapsed = this.collapsed.has(key);
			let rows = "";
			for (const dream of dreams)
			{
				const selected = this.activeKind === "dream" && this.dreams.GetActiveDream()?.id === dream.id;
				const title = dream.title || "Untitled";
				const rename = selected ? `<button class="workspace-row-action dream-icon-button button-control" data-rename-workspace-dream="${EscapeHtml(dream.id)}" type="button" title="Rename ${EscapeHtml(title)}" aria-label="Rename ${EscapeHtml(title)}">${EditIcon}</button>` : "";
				rows += `<div class="workspace-item-with-action${selected ? " selected" : ""}"><button class="workspace-tree-row workspace-item-row button-control${selected ? " selected" : ""}" data-workspace-dream="${EscapeHtml(dream.id)}" type="button" role="treeitem" aria-current="${selected}"><span class="workspace-item-icon" aria-hidden="true">${DocumentIcon}</span><span>${EscapeHtml(title)} <span class="catalogue-reference">(${EscapeHtml(this.FormatSourceRange(dream))})</span></span></button>${rename}</div>`;
			}
			books += `<section class="workspace-tree-folder workspace-book-group"><button class="workspace-tree-row button-control" data-workspace-toggle="${EscapeHtml(key)}" type="button" role="treeitem" aria-expanded="${!collapsed}"><span class="workspace-tree-disclosure" aria-hidden="true"></span><span>${book === "Other" ? "Other" : `Book ${this.FormatBookNumber(book)}`}</span></button><div class="workspace-tree-children"${collapsed ? " hidden" : ""}>${rows}</div></section>`;
		}
		if (books.length === 0) books = `<p class="workspace-tree-empty">${query.length > 0 ? "No matching Dreams." : "No Dreams yet."}</p>`;
		const selectionAvailable = this.library.GetSelection() !== null;
		const disabled = selectionAvailable ? "" : " disabled";
		const tooltip = selectionAvailable ? "New Dream from selection" : "Select a passage to create a Dream";
		return `<section class="workspace-tree-folder"><div class="workspace-tree-folder-heading"><button class="workspace-tree-row button-control" data-workspace-toggle="dreams" type="button" role="treeitem" aria-expanded="${!isCollapsed}"><span class="workspace-tree-disclosure" aria-hidden="true"></span><span>Dreams</span></button><span class="workspace-folder-action-wrap" title="${tooltip}"><button class="workspace-folder-action dream-icon-button button-control" data-new-workspace-dream type="button" aria-label="${tooltip}"${disabled}>${AddIcon}</button></span></div><div class="workspace-tree-children"${isCollapsed ? " hidden" : ""}>${books}</div></section>`;
	}

	private RefreshTabs(): void
	{
		this.tabsRoot.innerHTML = this.RenderTabs();
	}

	private RenderTabs(): string
	{
		const dreamTabs = new Map(this.dreamController.GetOpenTabs().map((tab) => [tab.dreamId, tab]));
		const ideaTabs = new Map(this.ideaController.GetOpenTabs().map((tab) => [tab.key, tab]));
		let items = "";
		for (const reference of this.tabOrder)
		{
			if (reference.kind === "dream")
			{
				const tab = dreamTabs.get(reference.key);
				if (tab === undefined) continue;
				const selected = this.activeKind === "dream" && this.dreams.GetActiveDream()?.id === tab.dreamId;
				const dirty = tab.isDirty ? `<span class="dream-document-tab-dirty" aria-label="Unsaved changes"></span>` : "";
				items += this.RenderTab("dream", tab.dreamId, tab.title, DocumentIcon, selected, dirty);
			}
			else
			{
				const tab = ideaTabs.get(reference.key);
				if (tab === undefined) continue;
				const selected = this.activeKind === "idea" && this.GetActiveIdeaKey() === tab.key;
				items += this.RenderTab("idea", tab.key, tab.title, IdeaIcon, selected, "");
			}
		}
		const actions = this.activeKind === "dream"
			? this.RenderDreamActions()
			: this.activeKind === "idea"
				? this.RenderIdeaActions()
				: "";
		if (items.length === 0) return "";
		return `<div class="dream-document-bar workspace-document-bar"><div class="dream-document-tabs" role="tablist" aria-label="Open Ideas and Dreams">${items}</div><div class="dream-document-actions">${actions}</div></div>`;
	}

	private RenderTab(kind: WorkspaceDocumentKind, key: string, title: string, icon: string, selected: boolean, dirty: string): string
	{
		const escapedKey = EscapeHtml(key);
		const escapedTitle = EscapeHtml(title);
		return `<div class="dream-document-tab${selected ? " selected" : ""}" role="presentation"><button class="dream-document-tab-label button-control" data-workspace-tab-kind="${kind}" data-workspace-tab="${escapedKey}" type="button" role="tab" aria-selected="${selected}" title="${escapedTitle}"><span class="dream-document-tab-icon" aria-hidden="true">${icon}</span><span>${escapedTitle}</span></button>${dirty}<button class="dream-document-tab-close button-control" data-close-workspace-tab-kind="${kind}" data-close-workspace-tab="${escapedKey}" type="button" title="Close ${escapedTitle}" aria-label="Close ${escapedTitle}">${CloseIcon}</button></div>`;
	}

	private RenderDreamActions(): string
	{
		const returnHidden = this.canReturnToIdea ? "" : " hidden";
		const status = this.dreams.GetSaveState() === "saving" ? "Saving…" : this.dreams.GetSaveState() === "error" ? "Save failed" : this.dreams.GetIsDirty() ? "Unsaved" : "Saved";
		return `<button class="dream-icon-button button-control" data-return-to-idea type="button" title="Back to Idea" aria-label="Back to Idea"${returnHidden}>${PreviousIcon}</button><span class="dream-toolbar-status" role="status" aria-live="polite">${status}</span><details class="action-menu"><summary title="Dream actions" aria-label="Dream actions">${MoreIcon}</summary><div class="action-menu-items"><button data-workspace-save-dream type="button">${SaveIcon}Save</button><button data-workspace-close-dream type="button">${CloseIcon}Close</button><button data-workspace-delete-dream type="button">${TrashIcon}Delete</button><button data-workspace-copy-dream type="button">Copy as Markdown</button></div></details>`;
	}

	// Renders the upper-right actions menu for the active Idea.
	private RenderIdeaActions(): string
	{
		const draft = this.ideas.GetDraft();
		const deleteAction = draft !== null && this.ideas.HasIdea(draft.ideaId)
			? `<button data-workspace-delete-idea type="button">${TrashIcon}Delete</button>`
			: "";
		const actions = `<button data-workspace-save-idea type="button">${SaveIcon}Save</button><button data-workspace-close-idea type="button">${CloseIcon}Close</button>${deleteAction}`;

		return `<details class="action-menu"><summary title="Idea actions" aria-label="Idea actions">${MoreIcon}</summary><div class="action-menu-items">${actions}</div></details>`;
	}

	private ReconcileTabOrder(): void
	{
		const available = new Set<string>();
		for (const tab of this.dreamController.GetOpenTabs()) available.add(`dream:${tab.dreamId}`);
		for (const tab of this.ideaController.GetOpenTabs()) available.add(`idea:${tab.key}`);
		this.tabOrder = this.tabOrder.filter((tab) => available.has(`${tab.kind}:${tab.key}`));
		for (const identity of available)
		{
			const separator = identity.indexOf(":");
			const kind = identity.slice(0, separator) as WorkspaceDocumentKind;
			const key = identity.slice(separator + 1);
			if (!this.tabOrder.some((tab) => tab.kind === kind && tab.key === key)) this.tabOrder.push({ kind, key });
		}
	}

	private HandleDreamOpened(): void
	{
		this.activeKind = "dream";
		this.Update();
	}

	private HandleDreamClosed(): void
	{
		if (this.activeKind === "dream")
		{
			if (this.ideas.GetDraft() !== null) this.activeKind = "idea";
			else if (this.dreams.GetActiveDream() === null) this.activeKind = null;
		}
		this.Update();
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

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const workId = target?.closest<HTMLElement>("[data-workspace-work]")?.dataset.workspaceWork;
		if (workId !== undefined)
		{
			if (workId !== this.library.GetText()?.id) void this.events.PublishAsync("library.text-open-requested", { textId: workId });
			return;
		}
		if (target?.closest("[data-add-work]") !== null)
		{
			this.OpenWorkPicker();
			return;
		}
		const toggle = target?.closest<HTMLElement>("[data-workspace-toggle]")?.dataset.workspaceToggle;
		if (toggle !== undefined)
		{
			if (this.collapsed.has(toggle)) this.collapsed.delete(toggle);
			else this.collapsed.add(toggle);
			this.Update();
			return;
		}
		const dreamId = target?.closest<HTMLElement>("[data-workspace-dream]")?.dataset.workspaceDream;
		if (dreamId !== undefined)
		{
			this.activeKind = "dream";
			this.dreamController.Open(dreamId);
			void this.events.PublishAsync("workspace.document-selected", { kind: "dream" });
			return;
		}
		const ideaId = target?.closest<HTMLElement>("[data-workspace-idea]")?.dataset.workspaceIdea;
		if (ideaId !== undefined)
		{
			void this.OpenIdeaAsync(ideaId);
			return;
		}
		if (target?.closest("[data-new-workspace-idea]") !== null)
		{
			void this.CreateIdeaAsync();
			return;
		}
		if (target?.closest("[data-new-workspace-dream]") !== null)
		{
			const selection = this.library.GetSelection();
			if (selection !== null)
			{
				this.activeKind = "dream";
				void this.dreamController.Create(selection);
			}
			return;
		}
		const renameId = target?.closest<HTMLElement>("[data-rename-workspace-dream]")?.dataset.renameWorkspaceDream;
		if (renameId !== undefined)
		{
			this.OpenDreamRenamePopup(renameId);
			return;
		}
		const tab = target?.closest<HTMLElement>("[data-workspace-tab]");
		const tabKey = tab?.dataset.workspaceTab;
		const tabKind = tab?.dataset.workspaceTabKind as WorkspaceDocumentKind | undefined;
		if (tabKey !== undefined && tabKind !== undefined)
		{
			this.ActivateTab(tabKind, tabKey);
			return;
		}
		const close = target?.closest<HTMLElement>("[data-close-workspace-tab]");
		const closeKey = close?.dataset.closeWorkspaceTab;
		const closeKind = close?.dataset.closeWorkspaceTabKind as WorkspaceDocumentKind | undefined;
		if (closeKey !== undefined && closeKind !== undefined)
		{
			void this.CloseTabAsync(closeKind, closeKey);
			return;
		}
		if (target?.closest("[data-workspace-save-dream]") !== null) void this.dreamController.SaveAsync();
		if (target?.closest("[data-workspace-close-dream]") !== null) void this.CloseActiveDreamAsync();
		const deleteDreamTrigger = target?.closest<HTMLElement>("[data-workspace-delete-dream]") ?? null;
		if (deleteDreamTrigger !== null) this.ConfirmDreamDelete(deleteDreamTrigger);
		if (target?.closest("[data-workspace-copy-dream]") !== null) void this.dreamController.CopyDreamAsMarkdownAsync();
		if (target?.closest("[data-workspace-save-idea]") !== null) void this.ideaController.SaveAsync();
		if (target?.closest("[data-workspace-close-idea]") !== null)
		{
			const key = this.GetActiveIdeaKey();
			if (key !== null) void this.CloseTabAsync("idea", key);
		}
		const deleteIdeaTrigger = target?.closest<HTMLElement>("[data-workspace-delete-idea]") ?? null;
		if (deleteIdeaTrigger !== null) this.ConfirmIdeaDelete(deleteIdeaTrigger);
		if (target?.closest("[data-return-to-idea]") !== null) void this.events.PublishAsync("idea.return-requested", {});
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

	// Marks valid Idea targets while a Signal is dragged over the Explorer.
	private HandleDragOver(event: DragEvent): void
	{
		const target = this.GetIdeaDropTarget(event.target as HTMLElement | null);

		if (target !== null && this.HasSignalDrag(event))
		{
			event.preventDefault();
			if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
			this.ClearSignalDropTargets();
			target.classList.add("signal-drop-target");
		}
	}

	// Clears one target after the pointer leaves it.
	private HandleDragLeave(event: DragEvent): void
	{
		const target = this.GetIdeaDropTarget(event.target as HTMLElement | null);
		const related = event.relatedTarget as Node | null;

		if (target !== null && (related === null || !target.contains(related)))
		{
			target.classList.remove("signal-drop-target");
		}
	}

	// Associates a dropped Signal with an existing Idea or starts a new Idea.
	private async HandleDropAsync(event: DragEvent): Promise<void>
	{
		const target = this.GetIdeaDropTarget(event.target as HTMLElement | null);
		const signalId = this.GetDraggedSignalId(event);

		if (target !== null && signalId !== null)
		{
			event.preventDefault();
			const ideaId = target.dataset.workspaceIdea;

			if (ideaId !== undefined)
			{
				this.ideaController.BeginAddToIdea({ signalId });
				await this.ideaController.AddPendingSignalToIdeaAsync(ideaId);
			}
			else
			{
				await this.ideaController.CreateFromSignalAsync({ signalId });
			}

			this.activeKind = "idea";
			this.ClearSignalDropTargets();
			this.Update();
			await this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
		}
	}

	// Returns an existing-Idea row or the Ideas heading as a valid drop target.
	private GetIdeaDropTarget(target: HTMLElement | null): HTMLElement | null
	{
		const idea = target?.closest<HTMLElement>("[data-workspace-idea]") ?? null;
		const heading = target?.closest<HTMLElement>('[data-workspace-toggle="ideas"]') ?? null;
		const dropTarget = idea ?? heading;

		return dropTarget;
	}

	// Returns whether the native drag contains a Chora Signal identity.
	private HasSignalDrag(event: DragEvent): boolean
	{
		const types = event.dataTransfer === null
			? []
			: Array.from(event.dataTransfer.types);
		const hasSignal = types.includes("application/x-chora-signal");

		return hasSignal;
	}

	// Reads and validates one Signal identity from native drag data.
	private GetDraggedSignalId(event: DragEvent): string | null
	{
		const value = event.dataTransfer?.getData("application/x-chora-signal").trim() ?? "";
		const signalId = value.length > 0 ? value : null;

		return signalId;
	}

	// Removes drag-target presentation from the Ideas tree.
	private ClearSignalDropTargets(): void
	{
		const targets = Array.from(this.explorerRoot.querySelectorAll(".signal-drop-target"));

		for (const target of targets) target.classList.remove("signal-drop-target");
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

	private async OpenIdeaAsync(ideaId: string): Promise<void>
	{
		if (this.ideas.GetPendingAddReference() !== null) await this.ideaController.AddPendingSignalToIdeaAsync(ideaId);
		else this.ideaController.Edit(ideaId);
		this.activeKind = "idea";
		this.Update();
		await this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
	}

	private async HandleIdeaOpenRequestedAsync(event: ChoraEvents["idea.open-requested"]): Promise<void>
	{
		this.ideaController.Edit(event.ideaId);
		this.activeKind = "idea";
		this.Update();
		await this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
	}

	// Keeps mixed workspace tabs synchronized with externally activated document editors.
	private HandleDocumentSelected(event: ChoraEvents["workspace.document-selected"]): void
	{
		this.activeKind = event.kind;
		this.Update();
	}

	private async CreateIdeaAsync(): Promise<void>
	{
		if (this.ideas.GetPendingAddReference() !== null) await this.ideaController.CreateIdeaFromPendingSignalAsync();
		else await this.ideaController.CreateAsync();
		this.activeKind = "idea";
		this.Update();
		await this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
	}

	private ActivateTab(kind: WorkspaceDocumentKind, key: string): void
	{
		this.activeKind = kind;
		if (kind === "dream") this.dreamController.ActivateTab(key);
		else this.ideaController.ActivateTab(key);
		this.Update();
		void this.events.PublishAsync("workspace.document-selected", { kind });
	}

	private async CloseTabAsync(kind: WorkspaceDocumentKind, key: string): Promise<void>
	{
		if (kind === "dream") await this.dreamController.CloseTabAsync(key);
		else
		{
			const draft = this.ideas.GetDraft();
			const isUnsavedIdea = key === "new"
				&& draft !== null
				&& draft.ideaId === null;
			const hasReaderContent = draft !== null
				&& (draft.title.trim().length > 0
					|| draft.content.trim().length > 0
					|| draft.originSignal !== null
					|| draft.relatedSignals.length > 0);

			if (isUnsavedIdea && hasReaderContent) this.OpenUnsavedIdeaPopup(key);
			else
			{
				this.ideaController.CloseTab(key);
				this.SelectAvailableDocument();
			}
		}
	}

	// Opens the close decision for one unsaved Idea without discarding its draft.
	private OpenUnsavedIdeaPopup(key: string): void
	{
		this.pendingUnsavedIdeaKey = key;
		const body = `<p>This Idea has not been saved.</p><p data-unsaved-idea-error role="alert" hidden>Unable to save the Idea. It remains open.</p><div class="popup-actions"><button class="button-control" data-unsaved-idea-save type="button">Save</button><button class="button-control" data-unsaved-idea-discard type="button">Close Without Saving</button><button class="button-control" data-unsaved-idea-cancel type="button">Cancel</button></div>`;
		this.unsavedIdeaPopup.SetBodyHtml(body);
		this.unsavedIdeaPopup.Open();
		const save = document.querySelector<HTMLButtonElement>('.popup-overlay:not([hidden]) [data-unsaved-idea-save]');
		save?.focus();
	}

	// Applies the reader's save, discard, or cancel decision for an unsaved Idea.
	private async HandleUnsavedIdeaClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const save = target?.closest<HTMLButtonElement>("[data-unsaved-idea-save]") ?? null;
		const discard = target?.closest<HTMLButtonElement>("[data-unsaved-idea-discard]") ?? null;
		const cancel = target?.closest<HTMLButtonElement>("[data-unsaved-idea-cancel]") ?? null;
		const pendingKey = this.pendingUnsavedIdeaKey;

		if (save !== null && pendingKey !== null)
		{
			const buttons = Array.from(save.closest(".popup-actions")?.querySelectorAll<HTMLButtonElement>("button") ?? []);
			const error = document.querySelector<HTMLElement>('.popup-overlay:not([hidden]) [data-unsaved-idea-error]');

			for (const button of buttons) button.disabled = true;
			if (error !== null) error.hidden = true;

			const saved = await this.ideaController.SaveAsync();

			if (saved)
			{
				const savedDraft = this.ideas.GetDraft();
				const savedKey = savedDraft?.ideaId ?? pendingKey;
				this.ideaController.CloseTab(savedKey);
				this.unsavedIdeaPopup.Close();
				this.SelectAvailableDocument();
			}
			else
			{
				for (const button of buttons) button.disabled = false;
				if (error !== null) error.hidden = false;
				save.focus();
			}
		}
		else if (discard !== null && pendingKey !== null)
		{
			this.ideaController.CloseTab(pendingKey);
			this.unsavedIdeaPopup.Close();
			this.SelectAvailableDocument();
		}
		else if (cancel !== null)
		{
			this.unsavedIdeaPopup.Close();
		}
	}

	// Clears transient close state whenever the prompt is dismissed.
	private HandleUnsavedIdeaPopupClosed(): void
	{
		this.pendingUnsavedIdeaKey = null;
	}

	private async CloseActiveDreamAsync(): Promise<void>
	{
		await this.dreamController.CloseAsync();
		this.SelectAvailableDocument();
	}

	private ConfirmDreamDelete(trigger: HTMLElement): void
	{
		const dream = this.dreams.GetActiveDream();

		if (dream !== null)
		{
			this.deleteConfirmation.Open(
				"Dream",
				dream.title,
				"The Dream will be moved to Chora Trash so it can be recovered.",
				trigger,
				async (): Promise<boolean> =>
			{
				const deleted = await this.dreamController.DeleteAsync();
				if (deleted) this.SelectAvailableDocument();

				return deleted;
			});
		}
	}

	// Confirms with the reader before deleting the active Idea.
	private ConfirmIdeaDelete(trigger: HTMLElement): void
	{
		const draft = this.ideas.GetDraft();

		if (draft !== null && this.ideas.HasIdea(draft.ideaId))
		{
			this.deleteConfirmation.Open(
				"Idea",
				draft.title,
				"This permanently deletes the Idea. Its connected Signals will remain available.",
				trigger,
				async (): Promise<boolean> =>
				{
					const deleted = await this.ideaController.DeleteAsync();
					if (deleted) this.SelectAvailableDocument();

					return deleted;
				});
		}
	}

	private OpenDreamRenamePopup(dreamId: string): void
	{
		const dream = this.dreams.GetCatalogue().find((candidate) => candidate.id === dreamId);
		if (dream === undefined) return;
		this.renamingDreamId = dreamId;
		this.activeKind = "dream";
		this.dreamController.Open(dreamId);
		this.dreamRenamePopup.SetBodyHtml(`<form class="dream-rename-form" data-workspace-dream-rename-form><label class="dream-field dream-settings-title"><span>Dream Name</span><input data-workspace-dream-title value="${EscapeHtml(dream.title)}" placeholder="Untitled Dream"></label><p class="dream-rename-error" data-workspace-dream-rename-error role="alert" hidden>Unable to save the Dream. Your new name has not been saved.</p><div class="dream-rename-actions"><button class="button-control" data-workspace-dream-rename-save type="submit">Save</button></div></form>`);
		this.dreamRenamePopup.Open();
		const input = document.querySelector<HTMLInputElement>('.popup-overlay:not([hidden]) [data-workspace-dream-title]');
		input?.focus();
		input?.select();
	}

	private async HandleDreamRenameSubmitAsync(event: Event): Promise<void>
	{
		const form = event.target instanceof HTMLFormElement && event.target.matches("[data-workspace-dream-rename-form]") ? event.target : null;
		if (form === null || this.renamingDreamId === null) return;
		event.preventDefault();
		const input = form.querySelector<HTMLInputElement>("[data-workspace-dream-title]");
		const button = form.querySelector<HTMLButtonElement>("[data-workspace-dream-rename-save]");
		const error = form.querySelector<HTMLElement>("[data-workspace-dream-rename-error]");
		if (input === null || button === null || error === null) return;

		const title = input.value.trim();
		input.value = title;
		button.disabled = true;
		error.hidden = true;
		this.dreamController.Open(this.renamingDreamId);
		this.dreamController.UpdateTitle(title);
		await this.dreamController.SaveAsync();

		if (this.dreams.GetSaveState() === "error")
		{
			button.disabled = false;
			error.hidden = false;
			input.focus();
			return;
		}

		this.renamingDreamId = null;
		this.dreamRenamePopup.Close();
	}

	private SelectAvailableDocument(): void
	{
		if (this.ideas.GetDraft() !== null) this.activeKind = "idea";
		else if (this.dreams.GetActiveDream() !== null) this.activeKind = "dream";
		else this.activeKind = null;
		this.Update();
		void this.events.PublishAsync("workspace.document-selected", { kind: this.activeKind });
	}

	private GetActiveIdeaKey(): string | null
	{
		const draft = this.ideas.GetDraft();
		return draft === null ? null : draft.ideaId ?? "new";
	}

	private MatchesIdea(idea: IdeaRecord, query: string): boolean
	{
		return query.length === 0 || this.Normalize(`${idea.title} ${idea.content}`).includes(query);
	}

	private ContainsSignal(idea: IdeaRecord, reference: IdeaSignalReference): boolean
	{
		const references = idea.originSignal === null
			? [...idea.relatedSignals]
			: [idea.originSignal, ...idea.relatedSignals];
		return references.some((candidate) => candidate.signalId === reference.signalId);
	}

	private Normalize(value: string): string
	{
		return value.trim().toLocaleLowerCase();
	}

	private FormatSourceRange(dream: DreamView): string
	{
		const document = this.library.GetText();
		const start = document?.id === dream.workId
			? document.ResolveCitation(dream.source.start)?.value
			: undefined;
		const end = document?.id === dream.workId
			? document.ResolveCitation(dream.source.end)?.value
			: undefined;
		if (start !== undefined && end !== undefined && start !== end) return `${start}–${end}`;
		return start ?? end ?? "source";
	}

	private FormatBookNumber(value: string): string
	{
		const numeric = Number.parseInt(value, 10);
		const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
		return numerals[numeric - 1] ?? value;
	}
}
