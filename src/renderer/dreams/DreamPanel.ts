import type { DreamView } from "./DreamView.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import { DreamController } from "./DreamController.js";
import type { DreamCatalogueController, DreamCatalogueGroup } from "./DreamCatalogueController.js";
import type { DreamSaveCoordinator } from "./DreamSaveCoordinator.js";
import { ChatStore } from "../chat/ChatStore.js";
import type { DreamExportController } from "./DreamExportController.js";
import type { DreamExplorerController } from "../workspace/DreamExplorerController.js";
import { DreamStore, type DreamSaveState } from "./DreamStore.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { PopupPanel } from "../ui/PopupPanel.js";
import { CloseIcon, EditIcon, AddIcon, SearchIcon, OpenIcon } from "../ui/Icons.js";
import { TabControl } from "../ui/TabControl.js";
import { DreamSignalsPanel } from "./DreamSignalsPanel.js";
import { DreamReflectionsPanel } from "./DreamReflectionsPanel.js";
import { DreamDiscussionPanel } from "./DreamDiscussionPanel.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { SignalController } from "../signals/SignalController.js";
import { LayoutSettings } from "../core/settings/LayoutSettingsStore.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import { RenderSemanticText } from "../library/SemanticTextMarkup.js";

// Which view of the DreamView feature this panel instance renders.
type DreamPanelMode = "catalogue" | "editor";

// Renders the DreamView catalogue and editor views and translates browser events into controller calls.
export class DreamPanel
{
	// Event-bus subscriptions released when the panel is disposed.
	private readonly subscriptions: Unsubscribe[] = [];
	// Routes editor initialization and cleanup failures through application diagnostics.
	private readonly errors: ErrorManager;
	// Book identifiers the reader explicitly collapsed in the Explorer tree.
	private readonly collapsedBooks = new Set<string>();
	// Whether the selected-text root is collapsed in the Explorer tree.
	private isTextRootCollapsed = false;
	// Persistent tab control for the open DreamView.
	private tabs: TabControl | null = null;
	// Signals content owned by the tab control.
	private signalsPanel: DreamSignalsPanel | null = null;
	private reflectionsPanel: DreamReflectionsPanel | null = null;
	// Retains conversation drafts and request identity across Dream tab switches.
	private readonly chatStates = new Map<string, ChatStore>();
	private discussionPanel: DreamDiscussionPanel | null = null;
	// Identity of the DreamView currently mounted in the editor.
	private mountedDreamId: string | null = null;
	// Popup containing the explicit DreamView rename workflow.
	private readonly manageSignalsPopup: PopupPanel | null;
	// Handles rename form submission for the popup lifetime.
	private readonly renameSubmitHandler: (event: Event) => void;
	// Handles rename input keyboard events for the popup lifetime.
	private readonly renameKeyDownHandler: (event: KeyboardEvent) => void;
	// Begins reader-driven source-passage resizing.
	private readonly sourceResizeDownHandler = this.HandleSourceResizePointerDown.bind(this);
	// Applies active source-passage resizing.
	private readonly sourceResizeMoveHandler = this.HandleSourceResizePointerMove.bind(this);
	// Completes active source-passage resizing.
	private readonly sourceResizeUpHandler = this.HandleSourceResizePointerUp.bind(this);
	// Active source-passage resize gesture.
	private sourceResizeDrag: { y: number; height: number } | null = null;

	// Wires up DOM and application-event listeners, then renders the initial view.
	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly store: DreamStore,
		private readonly controller: DreamController,
		private readonly library: LibraryStore,
		private readonly mode: DreamPanelMode,
		private readonly catalogue: DreamCatalogueController,
		private readonly saves: DreamSaveCoordinator,
		private readonly exports: DreamExportController,
		private readonly explorer: DreamExplorerController,
		private readonly signalController: SignalController | null = null)
	{
		this.errors = new ErrorManager(events);
		this.root.addEventListener("click", this.HandleClick.bind(this));
		this.root.addEventListener("input", this.HandleInput.bind(this));
		this.root.addEventListener("keydown", this.HandleKeyDown.bind(this));
		this.root.addEventListener("contextmenu", this.HandleContextMenuAsync.bind(this));
		this.root.addEventListener("pointerdown", this.sourceResizeDownHandler);
		this.renameSubmitHandler = this.HandleRenameSubmitAsync.bind(this);
		this.renameKeyDownHandler = this.HandleRenameKeyDown.bind(this);
		this.manageSignalsPopup = mode === "catalogue" ? new PopupPanel("Rename Dream") : null;

		if (this.manageSignalsPopup !== null)
		{
			this.manageSignalsPopup.OnBodySubmit(this.renameSubmitHandler);
			this.manageSignalsPopup.OnBodyKeyDown(this.renameKeyDownHandler);
		}
		const signalFocusHandler = this.HandleSignalFocusRequestedAsync.bind(this);
		const signalFocusSubscription = this.events.Subscribe("dream.signal-focus-requested", signalFocusHandler);
		this.subscriptions.push(signalFocusSubscription);
		this.subscriptions.push(this.events.Subscribe("dream.opened", this.HandleDreamOpened.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.catalogue-changed", this.HandleCatalogueChanged.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.passage-filter-changed", this.HandleCatalogueChanged.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.closed", this.HandleDreamClosed.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.saved", this.HandleDreamSaved.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.structure-changed", this.HandleStructureChanged.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.changed", this.HandleDreamStatusChanged.bind(this)));
		this.subscriptions.push(this.events.Subscribe("dream.save-state-changed", this.HandleDreamStatusChanged.bind(this)));
		this.subscriptions.push(this.events.Subscribe("library.text-opened", this.HandleTextOpened.bind(this)));
		this.Update();
	}

	// Releases every event-bus subscription owned by this panel.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		this.manageSignalsPopup?.Dispose();
		this.tabs?.Dispose();
		this.root.removeEventListener("pointerdown", this.sourceResizeDownHandler);
		window.removeEventListener("pointermove", this.sourceResizeMoveHandler);
		window.removeEventListener("pointerup", this.sourceResizeUpHandler);
	}

	// Re-renders the active view (catalogue or editor) and its status line.
	private Update(): void
	{
		const dream = this.store.GetActiveDream();
		if (this.mode === "catalogue") this.root.innerHTML = this.RenderCatalogue();
		else if (dream === null)
		{
			this.tabs?.Dispose();
			this.tabs = null;
			this.signalsPanel = null;
			this.reflectionsPanel = null;
			this.discussionPanel = null;
			this.mountedDreamId = null;
			this.root.replaceChildren();
		}
		else
		{
			if (this.mountedDreamId !== dream.id)
			{
				const previousTabId = this.tabs?.GetSelectedId();
				if (this.mountedDreamId !== null && previousTabId !== null && previousTabId !== undefined)
				{
					this.controller.RememberEditorTab(this.mountedDreamId, previousTabId);
				}
				this.tabs?.Dispose();
				this.root.innerHTML = this.RenderEditor(dream);
				this.signalsPanel = new DreamSignalsPanel(
					this.controller,
					this.events,
					this.signalController,
					this.errors);
				this.reflectionsPanel = new DreamReflectionsPanel(this.controller, dream.reflection, this.errors);
				let chatState = this.chatStates.get(dream.id);
				if (chatState === undefined)
				{
					chatState = new ChatStore();
					this.chatStates.set(dream.id, chatState);
				}
				this.discussionPanel = new DreamDiscussionPanel(dream.id, chatState, this.saves, this.store, this.library, this.errors);
				const rememberedTab = this.controller.GetEditorTab(dream.id);
				const selectedTab = rememberedTab === "description" ? "reflections" : rememberedTab;
				this.tabs = new TabControl(
					[this.signalsPanel, this.reflectionsPanel, this.discussionPanel],
					"Dream content",
					this.HandleEditorTabSelected.bind(this));
				this.tabs.Select(selectedTab);
				const host = this.root.querySelector("[data-dream-tabs]");
				host?.append(this.tabs.Root);
				this.mountedDreamId = dream.id;
			}
			this.signalsPanel?.Update(dream, this.library.GetText());
			this.reflectionsPanel?.Update(dream.reflection);
			const source = this.root.querySelector<HTMLElement>("[data-dream-source]");
			const sourceText = this.controller.ResolveSelectionText(dream.source);
			if (source !== null && source.textContent !== sourceText) source.textContent = sourceText;
			const meta = this.root.querySelector<HTMLElement>("[data-dream-source-meta]");
			if (meta !== null) meta.textContent = `${dream.dialogue ?? dream.workId} · ${this.FormatSourceRange(dream)}`;
		}
		this.UpdateStatus();
		this.RefreshManageSignalsPopup();
	}

	// Renders the catalogue header, search field, and grouped DreamView list.
	private RenderCatalogue(): string
	{
		const groups = this.catalogue.GetCatalogueGroups(this.store.GetSearchText());
		const content = this.RenderCatalogueContent(groups);
		const filter = this.RenderPassageFilter();
		const catalogue = `<section class="dream-catalogue left-tab-panel" aria-label="Dreams Explorer"><div class="dream-catalogue-controls"><label class="dream-search">${SearchIcon}<input data-dream-search type="search" aria-label="Search Dreams" placeholder="Search Dreams" value="${EscapeHtml(this.store.GetSearchText())}"></label><button class="catalogue-header-button button-control" data-new-dream type="button" title="New Dream" aria-label="New Dream">${AddIcon}</button></div>${filter}<div class="dream-catalogue-list" role="tree" aria-label="Dreams by Book">${content}</div></section>`;

		return catalogue;
	}

	// Renders the active source restriction and its explicit clear action.
	private RenderPassageFilter(): string
	{
		const filter = this.store.GetPassageFilter();
		let markup = "";
		if (filter !== null)
		{
			const label = EscapeHtml(filter.label);
			markup = `<div class="dream-passage-filter"><span>${label}</span><button class="dream-icon-button button-control" data-clear-passage-filter type="button" title="Clear passage filter" aria-label="Clear passage filter">${CloseIcon}</button></div>`;
		}
		return markup;
	}

	// Renders the catalogue body: an empty notice, a flat list, or division-grouped lists.
	private RenderCatalogueContent(groups: readonly DreamCatalogueGroup[]): string
	{
		let content = `<p class="dream-empty">No Dreams yet.</p>`;
		const document = this.library.GetText();
		const hasFilter = this.store.GetPassageFilter() !== null;
		const hasSearch = this.store.GetSearchText().trim().length > 0;
		if (hasFilter || hasSearch)
		{
			content = `<p class="dream-empty">No matching Dreams.</p>`;
		}

		if (groups.length > 0)
		{
			const firstGroup = groups[0];
			const isFlat = groups.length === 1 && firstGroup?.book === null && firstGroup.label === "";
			content = isFlat ? this.RenderCatalogueItems(firstGroup.dreams) : this.RenderCatalogueGroups(groups);
		}
		if (document !== null)
		{
			const title = document.id === "republic" ? "The Republic" : document.title;
			content = this.RenderTextRoot(title, content);
		}

		return content;
	}

	// Wraps the selected text's Book groups in the top-level Explorer node.
	private RenderTextRoot(title: string, content: string): string
	{
		const isExpanded = !this.isTextRootCollapsed;
		const root = `<section class="catalogue-text-root"><button class="catalogue-text-toggle button-control" data-text-toggle type="button" role="treeitem" aria-level="1" aria-expanded="${isExpanded}"><span class="catalogue-group-disclosure" aria-hidden="true"></span><span>${EscapeHtml(title)}</span></button><div class="catalogue-text-content" role="group"${isExpanded ? "" : " hidden"}>${content}</div></section>`;

		return root;
	}

	// Renders each division group in order.
	private RenderCatalogueGroups(groups: readonly DreamCatalogueGroup[]): string
	{
		let content = "";

		for (const group of groups) content += this.RenderCatalogueGroup(group.label, group.book, group.dreams);

		return content;
	}

	// Renders a flat, ungrouped list of catalogue items.
	private RenderCatalogueItems(dreams: readonly DreamView[]): string
	{
		let content = "";

		for (const dream of dreams) content += this.RenderCatalogueItem(dream);

		return content;
	}

	// Renders one division group, collapsed unless it is a book the reader has expanded or a search is active.
	private RenderCatalogueGroup(label: string, book: string | null, dreams: readonly DreamView[]): string
	{
		const isSearching = this.store.GetSearchText().trim().length > 0;
		const hasPassageFilter = this.store.GetPassageFilter() !== null;
		const isExpanded = book === null || isSearching || hasPassageFilter || !this.collapsedBooks.has(book);
		const header = book === null ? `<h4>${EscapeHtml(label)}</h4>` : `<button class="catalogue-group-toggle button-control" data-book-toggle="${EscapeHtml(book)}" type="button" role="treeitem" aria-level="2" aria-expanded="${isExpanded}"><span class="catalogue-group-disclosure" aria-hidden="true"></span><span>${EscapeHtml(label)}</span></button>`;
		const content = this.RenderCatalogueItems(dreams);
		const group = `<section class="catalogue-group">${header}<div class="catalogue-group-content" role="group"${isExpanded ? "" : " hidden"}>${content}</div></section>`;

		return group;
	}

	// Renders one catalogue row for a single DreamView.
	private RenderCatalogueItem(dream: DreamView): string
	{
		const isActive = dream.id === this.store.GetActiveDream()?.id;
		const range = this.FormatSourceRange(dream);
		const context = `${dream.dialogue ?? dream.workId} · ${range}`;
		const dreamId = EscapeHtml(dream.id);
		const title = EscapeHtml(dream.title || "Untitled");
		const item = `<div class="catalogue-item-row${isActive ? " selected" : ""}"><button class="catalogue-item button-control${isActive ? " selected" : ""}" type="button" role="treeitem" aria-level="3" data-dream-id="${dreamId}" aria-current="${isActive ? "true" : "false"}" title="${EscapeHtml(context)}"><span class="catalogue-item-copy"><strong>${title}</strong><span class="catalogue-reference">(${EscapeHtml(range)})</span></span></button><button class="catalogue-item-rename dream-icon-button button-control" data-rename-dream="${dreamId}" type="button" title="Rename ${title}" aria-label="Rename ${title}">${EditIcon}</button></div>`;

		return item;
	}

	// Creates the persistent editor shell for a newly opened DreamView.
	private RenderEditor(dream: DreamView): string
	{
		const source = this.RenderDreamSource(dream);
		const title = EscapeHtml(dream.title);
		const editor = `<div class="dream-editor-stack"><section class="dream-panel dream-editor document-editor"><section class="dream-interpretation document-interpretation"><div class="dream-section-eyebrow">Dream</div><label><span>Title</span><input data-dream-editor-title value="${title}" placeholder="Name this Dream"></label></section>${source}<div class="dream-source-divider" data-dream-source-divider role="separator" tabindex="0" aria-label="Resize Source Passage" aria-orientation="horizontal"></div><section class="dream-signals-section document-signals-section" aria-label="Dream content"><div class="dream-tabs-host document-signal-view-host" data-dream-tabs></div></section></section></div>`;

		return editor;
	}

	// Persists inner editor-tab selection for the active DreamView session.
	private HandleEditorTabSelected(tabId: string): void
	{
		const dreamId = this.store.GetActiveDream()?.id;
		if (dreamId !== undefined) this.controller.RememberEditorTab(dreamId, tabId);
	}

	// Renders the DreamView's source-passage section.
	private RenderDreamSource(dream: DreamView): string
	{
		const range = this.FormatSourceRange(dream);
		const meta = `${EscapeHtml(dream.dialogue ?? dream.workId)} &middot; ${EscapeHtml(range)}`;
		const height = LayoutSettings.GetDimension("dreamSourceHeight", 116);
		const sourceText = this.RenderDreamSourceText(dream);
		const source = `<details class="dream-section dream-source-section" style="height: ${height}px" open><summary>Source Passage <span class="dream-source-meta" data-dream-source-meta>${meta}</span></summary><button class="dream-source-jump button-control" data-jump-source type="button" title="Jump to source passage" aria-label="Jump to source passage">${OpenIcon}</button><blockquote class="dream-source" data-dream-source>${sourceText}</blockquote></details>`;

		return source;
	}

	// Renders the selected source range while retaining semantic quotation markup.
	private RenderDreamSourceText(dream: DreamView): string
	{
		const document = this.library.GetText();
		const pieces: string[] = [];

		if (document !== null && document.id === dream.source.documentId)
		{
			const startIndex = document.segments.findIndex(function FindStart(segment): boolean
			{
				return segment.key === dream.source.start.segmentKey;
			});
			const endIndex = document.segments.findIndex(function FindEnd(segment): boolean
			{
				return segment.key === dream.source.end.segmentKey;
			});

			for (let index = startIndex; index >= 0 && index <= endIndex; index += 1)
			{
				const segment = document.segments[index];
				if (segment !== undefined)
				{
					const start = index === startIndex ? dream.source.start.offset : 0;
					const end = index === endIndex ? dream.source.end.offset : segment.text.length;
					pieces.push(RenderSemanticText(segment.text, segment.annotations, start, end));
				}
			}
		}

		const markup = pieces.length > 0
			? pieces.join("\n")
			: EscapeHtml(this.controller.ResolveSelectionText(dream.source));

		return markup;
	}

	// Begins resizing the Source Passage from its dedicated horizontal divider.
	private HandleSourceResizePointerDown(event: PointerEvent): void
	{
		const divider = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-dream-source-divider]");
		const source = this.root.querySelector<HTMLDetailsElement>(".dream-source-section");

		if (divider !== null && divider !== undefined && source !== null && event.button === 0)
		{
			event.preventDefault();
			this.sourceResizeDrag = { y: event.clientY, height: source.getBoundingClientRect().height };
			divider.classList.add("is-active");
			window.addEventListener("pointermove", this.sourceResizeMoveHandler);
			window.addEventListener("pointerup", this.sourceResizeUpHandler, { once: true });
		}
	}

	// Applies pointer movement to the Source Passage height.
	private HandleSourceResizePointerMove(event: PointerEvent): void
	{
		if (this.sourceResizeDrag !== null)
		{
			const height = this.sourceResizeDrag.height + event.clientY - this.sourceResizeDrag.y;
			this.SetSourceHeight(height);
		}
	}

	// Ends Source Passage resizing and clears its active presentation.
	private HandleSourceResizePointerUp(): void
	{
		this.sourceResizeDrag = null;
		window.removeEventListener("pointermove", this.sourceResizeMoveHandler);
		window.removeEventListener("pointerup", this.sourceResizeUpHandler);
		this.root.querySelector<HTMLElement>("[data-dream-source-divider]")?.classList.remove("is-active");
	}

	// Clamps, applies, and persists one Source Passage height.
	private SetSourceHeight(height: number): void
	{
		const editor = this.root.querySelector<HTMLElement>(".dream-editor.document-editor");
		const source = this.root.querySelector<HTMLDetailsElement>(".dream-source-section");

		if (editor !== null && source !== null)
		{
			const maximum = Math.max(96, editor.getBoundingClientRect().height - 300);
			const bounded = Math.max(72, Math.min(maximum, height));
			source.style.height = `${bounded}px`;
			LayoutSettings.SetDimension("dreamSourceHeight", bounded);
			const divider = this.root.querySelector<HTMLElement>("[data-dream-source-divider]");
			divider?.setAttribute("aria-valuemin", "72");
			divider?.setAttribute("aria-valuemax", `${maximum}`);
			divider?.setAttribute("aria-valuenow", `${bounded}`);
		}
	}

	// Displays distinct source endpoints without repeating a single passage label.
	private FormatSourceRange(dream: DreamView): string
	{
		const range = this.controller.FormatSelectionRange(dream.source);

		return range;
	}

	// Opens the rename popup for the active DreamView.
	private OpenManageSignalsPopup(): void
	{
		const dream = this.store.GetActiveDream();

		if (this.manageSignalsPopup !== null && dream !== null)
		{
			const title = EscapeHtml(dream.title);
			const body = `<form class="dream-rename-form" data-dream-rename-form><label class="dream-field dream-settings-title"><span>Dream Name</span><input data-dream-title value="${title}" placeholder="Untitled Dream"></label><p class="dream-rename-error" data-dream-rename-error role="alert" hidden>Unable to save the Dream. Your new name has not been saved.</p><div class="dream-rename-actions"><button class="button-control" data-dream-rename-save type="submit">Save</button></div></form>`;
			this.manageSignalsPopup.SetBodyHtml(body);
			this.manageSignalsPopup.Open();
			const input = document.querySelector<HTMLInputElement>("[data-dream-title]");
			input?.focus();
			input?.select();
		}
	}

	// Closes the rename popup when its DreamView is no longer open.
	private RefreshManageSignalsPopup(): void
	{
		const dream = this.store.GetActiveDream();
		if (this.manageSignalsPopup !== null && this.manageSignalsPopup.IsOpen)
		{
			if (dream === null) this.manageSignalsPopup.Close();
		}
	}

	// Commits the entered name through the existing DreamView save workflow.
	private async HandleRenameSubmitAsync(event: Event): Promise<void>
	{
		const form = event.target instanceof HTMLFormElement && event.target.matches("[data-dream-rename-form]") ? event.target : null;

		if (form !== null)
		{
			event.preventDefault();
			const input = form.querySelector<HTMLInputElement>("[data-dream-title]");
			const button = form.querySelector<HTMLButtonElement>("[data-dream-rename-save]");
			const error = form.querySelector<HTMLElement>("[data-dream-rename-error]");

			if (input !== null && button !== null && error !== null)
			{
				const title = input.value.trim();
				input.value = title;
				button.disabled = true;
				error.hidden = true;
				this.controller.UpdateTitle(title);
				this.UpdateStatus();
				await this.saves.SaveAsync();
				this.UpdateStatus();
				const saveFailed = this.store.GetSaveState() === "error";

				if (saveFailed)
				{
					button.disabled = false;
					error.hidden = false;
					input.focus();
				}
				else if (this.manageSignalsPopup !== null)
				{
					this.manageSignalsPopup.Close();
				}
			}
		}
	}

	// Submits the rename form when Enter is pressed in its single-line name field.
	private HandleRenameKeyDown(event: KeyboardEvent): void
	{
		const input = event.target instanceof HTMLInputElement && event.target.matches("[data-dream-title]") ? event.target : null;
		if (event.key === "Enter" && input !== null && !event.ctrlKey && !event.metaKey && !event.altKey)
		{
			event.preventDefault();
			const form = input.form;

			if (form !== null)
			{
				form.requestSubmit();
			}
		}
	}

	// Routes a click anywhere in the panel to the action implied by the element the reader clicked.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const dreamId = target?.closest<HTMLElement>("[data-dream-id]")?.dataset.dreamId;
		const renameDreamId = target?.closest<HTMLElement>("[data-rename-dream]")?.dataset.renameDream;
		const actionMenu = target?.closest<HTMLDetailsElement>(".action-menu");
		if (actionMenu !== null && actionMenu !== undefined && target?.closest("button") !== null) actionMenu.open = false;
		const book = target?.closest<HTMLElement>("[data-book-toggle]")?.dataset.bookToggle;
		const textToggle = target?.closest("[data-text-toggle]");
		const clearFilter = target?.closest("[data-clear-passage-filter]");
		if (clearFilter !== null && clearFilter !== undefined)
		{
			void this.catalogue.ClearPassageFilterAsync();
		}

		if (renameDreamId !== undefined)
		{
			if (this.store.GetActiveDream()?.id === renameDreamId)
			{
				this.OpenManageSignalsPopup();
			}
			else
			{
				this.controller.Open(renameDreamId);
				window.setTimeout(this.OpenManageSignalsPopup.bind(this), 0);
			}
		}
		else if (dreamId !== undefined) this.controller.Open(dreamId);
		if (textToggle !== null && textToggle !== undefined)
		{
			this.isTextRootCollapsed = !this.isTextRootCollapsed;
			this.Update();
		}
		if (book !== undefined)
		{
			if (this.collapsedBooks.has(book)) this.collapsedBooks.delete(book);
			else this.collapsedBooks.add(book);
			this.Update();
		}
		if (target?.closest("[data-save-dream]") !== null) void this.saves.SaveAsync();
		if (target?.closest("[data-close-dream]") !== null) void this.controller.CloseAsync();
		if (target?.closest("[data-copy-dream-markdown]") !== null) void this.CopyDreamAsMarkdownAsync();
		if (target?.closest("[data-new-dream]") !== null) this.CreateDreamFromSelection();
		if (target?.closest("[data-jump-source]") !== null)
		{
			const selection = this.store.GetActiveDream()?.source;
			if (selection !== undefined) void this.events.PublishAsync("library.jump-requested", { selection });
		}

	}

	// Copies the active DreamView's complete Markdown export and reports clipboard failures.
	private async CopyDreamAsMarkdownAsync(): Promise<void>
	{
		try
		{
			await this.exports.CopyDreamAsMarkdownAsync();
		}
		catch (error)
		{
			this.errors.Report("DreamPanel", error, "The Dream could not be copied as Markdown.");
		}
	}

	// Routes an input event on a tracked field to the matching controller or store call.
	private HandleInput(event: Event): void
	{
		const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;

		if (target?.matches("[data-dream-search]") === true)
		{
			this.store.SetSearchText(target.value);
			this.RefreshCatalogueList();
		}
		else if (target?.matches("[data-dream-editor-title]") === true)
		{
			this.controller.UpdateTitle(target.value);
		}
	}

	// Re-renders only the catalogue list, in place, after the search query changes.
	private RefreshCatalogueList(): void
	{
		const list = this.root.querySelector<HTMLElement>(".dream-catalogue-list");

		if (list !== null)
		{
			const groups = this.catalogue.GetCatalogueGroups(this.store.GetSearchText());
			list.innerHTML = this.RenderCatalogueContent(groups);
		}
	}

	// Starts a new DreamView from the reader's current passage selection.
	private CreateDreamFromSelection(): void
	{
		void this.explorer.CreateFromCurrentSelectionAsync();
	}

	// Saves the active DreamView on Ctrl/Cmd+Enter.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const sourceDivider = (event.target as HTMLElement | null)?.closest("[data-dream-source-divider]") !== null;
		if (sourceDivider && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End"))
		{
			event.preventDefault();
			const source = this.root.querySelector<HTMLDetailsElement>(".dream-source-section");
			const currentHeight = source?.getBoundingClientRect().height ?? 144;
			let height = currentHeight + (event.key === "ArrowDown" ? 24 : -24);
			if (event.key === "Home") height = 72;
			if (event.key === "End") height = Number.MAX_SAFE_INTEGER;
			this.SetSourceHeight(height);
		}
		if (event.key === "Escape")
		{
			const menu = (event.target as HTMLElement | null)?.closest<HTMLDetailsElement>(".action-menu");
			if (menu !== null && menu !== undefined)
			{
				menu.open = false;
				menu.querySelector<HTMLElement>("summary")?.focus();
			}
		}
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
		{
			event.preventDefault();
			event.stopPropagation();
			void this.saves.SaveAsync();
		}
	}

	// Shows the source-passage context menu when the reader right-clicks a selection within it.
	private async HandleContextMenuAsync(event: Event): Promise<void>
	{
		const selection = this.CaptureSourceSelection();

		if (selection !== null)
		{
			event.preventDefault();
			await this.controller.HandleTextSelectionAsync(selection);
		}
	}

	// Converts the current browser range inside the Dream source into a canonical text selection.
	private CaptureSourceSelection(): TextSelection | null
	{
		const source = this.root.querySelector<HTMLElement>("[data-dream-source]");
		const browserSelection = window.getSelection();
		const range = browserSelection !== null && browserSelection.rangeCount > 0 ? browserSelection.getRangeAt(0) : null;
		const isInsideSource = source !== null && range !== null && !range.collapsed && source.contains(range.commonAncestorContainer);
		const dream = this.store.GetActiveDream();
		const document = this.library.GetText();
		let selection: TextSelection | null = null;

		if (source !== null && range !== null && isInsideSource && dream !== null && document !== null)
		{
			const prefix = range.cloneRange();
			prefix.selectNodeContents(source);
			prefix.setEnd(range.startContainer, range.startOffset);
			const startOffset = prefix.toString().length;
			const endOffset = startOffset + range.toString().length;
			selection = this.controller.CreateTextSelection(document, dream.source, startOffset, endOffset);
		}

		return selection;
	}

	// Refreshes the status line and disables the save buttons while a save is in flight.
	private UpdateStatus(): void
	{
		const status = this.root.querySelector<HTMLElement>("[data-dream-status]");
		const saveButtons = this.root.querySelectorAll<HTMLButtonElement>("[data-save-dream]");
		const saveState = this.store.GetSaveState();

		if (status !== null) status.textContent = this.GetStatusText(saveState);

		for (let index = 0; index < saveButtons.length; index += 1)
		{
			const button = saveButtons[index];
			if (button !== undefined) 			button.disabled = saveState === "saving";
		}
	}

	// Re-renders the editor and selects one explicitly requested Signal without scrolling.
	private async UpdateAndSelectSignalAsync(signalId: string): Promise<void>
	{
		this.Update();
		this.tabs?.Select("signals");
		const signalsPanel = this.signalsPanel;

		if (signalsPanel !== null)
		{
			await signalsPanel.ShowSignalAsync(signalId);
		}
	}

	// Returns the reader-facing status line for the current dirty/save state.
	private GetStatusText(saveState: DreamSaveState): string
	{
		let text = this.store.GetIsDirty() ? "Unsaved" : "Saved";

		if (saveState === "saving") text = "Saving…";
		if (saveState === "error") text = "Save failed";

		return text;
	}

	// Re-renders the view when a DreamView is opened.
	private HandleDreamOpened(): void
	{
		this.manageSignalsPopup?.Close();
		this.Update();
	}

	// Re-renders the view when the catalogue changes.
	private HandleCatalogueChanged(): void
	{
		this.Update();
	}

	// Re-renders the view when the active DreamView is closed.
	private HandleDreamClosed(): void
	{
		this.manageSignalsPopup?.Close();
		this.Update();
	}

	// Refreshes the status line after a DreamView is saved.
	private HandleDreamSaved(): void
	{
		if (this.mode === "catalogue")
		{
			this.Update();
		}
		else
		{
			this.UpdateStatus();
		}
	}

	// Re-renders the view when the active DreamView's structure changes.
	private HandleStructureChanged(event: ChoraEvents["dream.structure-changed"]): void
	{
		if (this.store.GetActiveDream()?.id === event.dreamId)
		{
			this.Update();
		}
	}

	// Selects a specifically requested Signal without moving either pane.
	private async HandleSignalFocusRequestedAsync(event: ChoraEvents["dream.signal-focus-requested"]): Promise<void>
	{
		const dream = this.store.GetActiveDream();

		if (dream?.id === event.dreamId)
		{
			await this.UpdateAndSelectSignalAsync(event.signalId);
		}
	}

	// Refreshes the status line after the active DreamView's dirty or save state changes.
	private HandleDreamStatusChanged(): void
	{
		this.UpdateStatus();
	}

	// Re-renders the view when the open library text changes.
	private HandleTextOpened(): void
	{
		this.Update();
	}
}
