import "../styles.css";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents, ErrorRecord } from "../core/events/ChoraEvents.js";
import type { TextDocument } from "../../shared/library/LibraryTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import { LibraryController } from "../library/LibraryController.js";
import { LibraryGateway } from "../library/LibraryGateway.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { DreamController } from "../dreams/DreamController.js";
import { DreamGateway } from "../dreams/DreamGateway.js";
import { DreamStore } from "../dreams/DreamStore.js";
import { DocumentPanel } from "../library/DocumentPanel.js";
import { DreamPanel } from "../dreams/DreamPanel.js";
import { DreamPassagePanel } from "../dreams/DreamPassagePanel.js";
import { SessionStore } from "../core/session/SessionStore.js";
import { IdeaController } from "../ideas/IdeaController.js";
import { IdeaGateway } from "../ideas/IdeaGateway.js";
import { IdeaPanel } from "../ideas/IdeaPanel.js";
import { IdeaStore } from "../ideas/IdeaStore.js";
import { SignalController } from "../signals/SignalController.js";
import { SignalGateway } from "../signals/SignalGateway.js";
import { SignalStore } from "../signals/SignalStore.js";
import { SignalPlacementController } from "../signals/SignalPlacementController.js";
import { SignalPlacementPanel } from "../signals/SignalPlacementPanel.js";
import { GetSignalAnchor } from "../../shared/signals/SignalSelection.js";
import { ReadingSettingsStore, type ReadingFont } from "../core/settings/ReadingSettingsStore.js";
import { LayoutSettings } from "../core/settings/LayoutSettingsStore.js";
import { LookupStore } from "../library/lookup/LookupStore.js";
import { LookupGateway } from "../library/lookup/LookupGateway.js";
import { LookupController } from "../library/lookup/LookupController.js";
import { LookupPanel } from "../library/lookup/LookupPanel.js";
import { CloseActionMenusOutside as CloseOpenActionMenus } from "../ui/ActionMenus.js";
import { WorkspacePanel } from "../workspace/WorkspacePanel.js";
import { DocumentIcon, IdeaIcon } from "../ui/Icons.js";
import { EscapeHtml } from "../ui/Html.js";
import { PopupPanel } from "../ui/PopupPanel.js";

type ResizablePane = "left" | "dream";

// Composes the renderer's features, wires the application shell, and owns its top-level DOM and window listeners.
export class ChoraApplication
{
	// Panels disposed when the application shuts down.
	private readonly disposables: Array<{ Dispose(): void }> = [];
	// Event-bus and gateway subscriptions released when the application shuts down.
	private readonly externalSubscriptions: Array<() => void> = [];
	// Bound window/root listeners, stored so the same reference can later be removed.
	private readonly keyDownHandler = (event: KeyboardEvent): void => void this.HandleKeyDownAsync(event);
	private readonly focusHandler = (): void => this.HandleWindowFocus();
	private readonly blurHandler = (): void => this.HandleWindowBlur();
	private readonly leftViewClickHandler = (event: Event): void => this.HandleLeftViewClick(event);
	private readonly settingsChangeHandler = (event: Event): void => this.HandleSettingsChange(event);
	private readonly panelResizePointerDownHandler = (event: PointerEvent): void => this.HandlePanelResizePointerDown(event);
	private readonly panelResizePointerMoveHandler = (event: PointerEvent): void => this.HandlePanelResizePointerMove(event);
	private readonly panelResizePointerUpHandler = (): void => this.StopPanelResize();
	private readonly actionMenuDismissHandler = (event: Event): void => this.CloseActionMenusOutside(event.target as Node | null);
	// Rebalances workspace columns when the native window changes size.
	private readonly windowResizeHandler = (): void => this.NormalizePanelWidths();
	// Which pane is being dragged, or null when no resize is in progress.
	private activeResizablePane: ResizablePane | null = null;
	// Pointer position and pane width captured when a resize drag begins.
	private resizeStartX = 0;
	private resizeStartWidth = 0;
	// Guards against disposing more than once.
	private isDisposed = false;
	// Guards against starting more than once.
	private isStarted = false;
	// Shared application event bus.
	private readonly events = new ChoraEventBus<ChoraEvents>();
	// Reports and logs application errors.
	private readonly errors = new ErrorManager(this.events);
	// Owns persisted session storage shared by Dream and Idea state.
	private readonly sessions = new SessionStore();
	// Owns Dream state used by the Library's source-extension eligibility query.
	private readonly dreamStore = new DreamStore(this.sessions);
	// Library: catalogue/active-text state, IPC client, and workflow coordinator.
	private readonly libraryStore = new LibraryStore();
	private readonly libraryGateway = new LibraryGateway();
	private readonly library = new LibraryController(
		this.events,
		this.errors,
		this.libraryStore,
		this.libraryGateway,
		this.GetActiveDreamSource.bind(this));
	private readonly signalStore = new SignalStore();
	private readonly signalGateway = new SignalGateway();
	private readonly signals = new SignalController(this.errors, this.signalStore, this.signalGateway, this.events);
	// Dreams: catalogue/active-Dream state, IPC client, and workflow coordinator.
	private readonly dreamGateway = new DreamGateway();
	private readonly dreams = new DreamController(this.events, this.errors, this.libraryStore, this.dreamStore, this.dreamGateway, this.signalStore);
	// Owns renderer-side Idea state.
	private readonly ideaStore = new IdeaStore(this.sessions);
	// Provides the stateless Idea IPC client.
	private readonly ideaGateway = new IdeaGateway();
	// Coordinates Signal-first Idea workflows.
	private readonly ideas = new IdeaController(this.events, this.errors, this.ideaStore, this.ideaGateway);
	private readonly signalPlacement = new SignalPlacementController(
		this.events,
		this.libraryStore,
		this.dreamStore,
		this.dreams,
		this.ideaStore,
		this.ideas,
		this.signalStore,
		this.signals);
	// Dream editor instance receiving contextual navigation state from Ideas.
	private dreamEditorPanel: DreamPanel | null = null;
	private workspacePanel: WorkspacePanel | null = null;
	private errorPopup: PopupPanel | null = null;
	// Whether the active Dream is a temporary Signal preview opened from an Idea.
	private isIdeaSignalPreview = false;

	// Owns reading appearance and font settings.
	private readonly settings = new ReadingSettingsStore();
	private readonly lookupStore = new LookupStore();
	private readonly lookupGateway = new LookupGateway();
	private readonly lookup = new LookupController(this.events, this.lookupStore, this.lookupGateway, this.errors);

	// Creates the application and routes event-bus subscriber failures to the error manager.
	public constructor(private readonly root: HTMLElement)
	{
		this.events.SetErrorHandler((failure) =>
		{
			this.errors.Report("ChoraEventBus", failure.error, `Something went wrong while handling ${String(failure.eventName)}.`);
		});
	}

	// Renders the application shell, mounts its feature panels, and starts each feature's workflows.
	public async StartAsync(): Promise<void>
	{
		if (!this.isDisposed && !this.isStarted)
		{
			this.isStarted = true;
			this.settings.Apply();
			this.root.innerHTML = `<main class="shell dream-open"><aside class="left-panel"><nav class="collapsed-explorer-rail" aria-label="Explorer sections"><button class="collapsed-explorer-button button-control" data-expand-explorer="idea" type="button" title="Expand Ideas" aria-label="Expand Ideas">${IdeaIcon}</button><button class="collapsed-explorer-button button-control" data-expand-explorer="dream" type="button" title="Expand Dreams" aria-label="Expand Dreams">${DocumentIcon}</button></nav><div class="left-view workspace-explorer-host" data-workspace-explorer></div></aside><section class="center-panel" data-document-panel></section><aside class="right-panel" data-editor-panel><div data-workspace-tabs></div><section class="editor-empty-state workspace-welcome" data-editor-empty aria-labelledby="editor-empty-heading"><h1 id="editor-empty-heading">Workspace</h1><p>Select an Idea or Dream from the Explorer.</p></section><div data-dream-panel hidden></div><div data-idea-editor-panel hidden></div></aside><div class="panel-resize-handle" data-resize-pane="left" role="separator" tabindex="0" aria-label="Resize Explorer" aria-orientation="vertical"></div><div class="panel-resize-handle" data-resize-pane="dream" role="separator" tabindex="0" aria-label="Resize editor" aria-orientation="vertical"></div></main>`;
			this.ApplyPersistedLayout();
			const explorerRoot = this.RequireElement("[data-workspace-explorer]");
			const tabsRoot = this.RequireElement("[data-workspace-tabs]");
			const readerColumn = this.RequireElement("[data-document-panel]");
			readerColumn.removeAttribute("data-document-panel");
			readerColumn.innerHTML = `<div class="reader-workspace"><section class="document-panel" data-document-panel></section><section data-lookup-panel aria-label="Dictionary" hidden></section></div>`;
			const documentRoot = this.RequireElement("[data-document-panel]");
			const dreamRoot = this.RequireElement("[data-dream-panel]");
			const ideaEditorRoot = this.RequireElement("[data-idea-editor-panel]");
			const lookupRoot = this.RequireElement("[data-lookup-panel]");
			this.disposables.push(new LookupPanel(lookupRoot, this.events, this.lookupStore, this.lookup));
			const ideaEditor = new IdeaPanel(ideaEditorRoot, this.events, this.ideaStore, this.ideas, this.dreamStore, "editor", this.signalStore, this.signals, this.libraryStore);
			this.disposables.push(ideaEditor);
			this.disposables.push(new SignalPlacementPanel(this.events, this.signalPlacement));
			this.disposables.push(new DocumentPanel(documentRoot, this.events, this.libraryStore, this.library, this.settings));
			const passagePanel = new DreamPassagePanel(documentRoot, this.events, this.libraryStore, this.dreams, this.ideaStore, this.signalStore);
			this.disposables.push(passagePanel);
			this.dreamEditorPanel = new DreamPanel(dreamRoot, this.events, this.dreamStore, this.dreams, this.libraryStore, "editor", this.ideaStore, this.signalStore, this.signals, this.ideas);
			this.disposables.push(this.dreamEditorPanel);
			this.workspacePanel = new WorkspacePanel(explorerRoot, tabsRoot, this.events, this.dreamStore, this.dreams, this.ideaStore, this.ideas, this.libraryStore);
			this.disposables.push(this.workspacePanel);
			this.root.addEventListener("click", this.leftViewClickHandler);
			this.root.addEventListener("change", this.settingsChangeHandler);
			this.root.addEventListener("pointerdown", this.panelResizePointerDownHandler);
			this.root.addEventListener("pointerdown", this.actionMenuDismissHandler);
			this.root.addEventListener("focusin", this.actionMenuDismissHandler);
			this.RegisterApplicationEvents();
			await this.lookup.StartAsync();
			await this.dreams.StartAsync();
			await this.library.StartAsync();
			this.errors.Info("ChoraApplication", "Application started.");
		}
	}

	// Disposes feature panels and releases every listener and subscription registered by this application.
	public Dispose(): void
	{
		if (!this.isDisposed)
		{
			this.isDisposed = true;
			for (const disposable of this.disposables) disposable.Dispose();
			for (const unsubscribe of this.externalSubscriptions) unsubscribe();
			this.lookup.Dispose();
			this.dreamStore.Dispose();
			this.CloseErrorPopup();
			this.root.removeEventListener("click", this.leftViewClickHandler);
			this.root.removeEventListener("change", this.settingsChangeHandler);
			this.root.removeEventListener("pointerdown", this.panelResizePointerDownHandler);
			this.root.removeEventListener("pointerdown", this.actionMenuDismissHandler);
			this.root.removeEventListener("focusin", this.actionMenuDismissHandler);
			window.removeEventListener("pointermove", this.panelResizePointerMoveHandler);
			window.removeEventListener("pointerup", this.panelResizePointerUpHandler);
			window.removeEventListener("keydown", this.keyDownHandler);
			window.removeEventListener("focus", this.focusHandler);
			window.removeEventListener("blur", this.blurHandler);
			window.removeEventListener("resize", this.windowResizeHandler);
			this.disposables.length = 0;
			this.externalSubscriptions.length = 0;
		}
	}

	private RegisterApplicationEvents(): void
	{
		const dreamOpened = this.events.Subscribe("dream.opened", this.HandleDreamOpened.bind(this));
		const dreamClosed = this.events.Subscribe("dream.closed", this.HandleDreamClosed.bind(this));
		const passageFiltered = this.events.Subscribe("dream.passage-filter-changed", this.HandlePassageFilterChanged.bind(this));
		this.externalSubscriptions.push(passageFiltered);
		const dreamsFocusRequested = this.events.Subscribe("workspace.dreams-focus-requested", this.HandleDreamsFocusRequested.bind(this));
		this.externalSubscriptions.push(dreamsFocusRequested);
		const errorReported = this.events.Subscribe("error.reported", this.HandleErrorReported.bind(this));
		const textOpened = this.events.Subscribe("library.text-opened", this.HandleTextOpened.bind(this));
		const ideaAddSignalHandler = this.HandleIdeaAddSignalRequested.bind(this);
		const ideaSignalViewHandler = this.HandleIdeaSignalViewRequestedAsync.bind(this);
		const ideaReturnHandler = this.HandleIdeaReturnRequested.bind(this);
		const ideasChangedHandler = this.HandleIdeasChanged.bind(this);
		const ideaAddSignalRequested = this.events.Subscribe("idea.add-signal-requested", ideaAddSignalHandler);
		const ideaSignalViewRequested = this.events.Subscribe("idea.signal-view-requested", ideaSignalViewHandler);
		const ideaReturnRequested = this.events.Subscribe("idea.return-requested", ideaReturnHandler);
		const ideasChanged = this.events.Subscribe("ideas.changed", ideasChangedHandler);
		const documentSelected = this.events.Subscribe("workspace.document-selected", this.HandleWorkspaceDocumentSelected.bind(this));
		this.externalSubscriptions.push(dreamOpened, dreamClosed, errorReported, textOpened, ideaAddSignalRequested, ideaSignalViewRequested, ideaReturnRequested, ideasChanged, documentSelected);
		this.externalSubscriptions.push(this.libraryGateway.SubscribeToSelection(this.HandleTextSelected.bind(this)));
		this.externalSubscriptions.push(this.libraryGateway.SubscribeToExternalText(this.HandleExternalTextLoaded.bind(this)));
		window.addEventListener("keydown", this.keyDownHandler);
		window.addEventListener("focus", this.focusHandler);
		window.addEventListener("blur", this.blurHandler);
		window.addEventListener("resize", this.windowResizeHandler);
		this.NormalizePanelWidths();
	}

	// Reveals the Dream editor when a Dream is opened.
	private HandleDreamOpened(): void
	{
		this.ShowEditorPanel("dream");
	}

	// Reveals passage-filtered Dreams without opening an editor or navigating the text.
	private HandlePassageFilterChanged(): void
	{
		this.root.querySelector<HTMLInputElement>("[data-workspace-search]")?.focus();
	}

	// Reveals the Dreams Explorer and places keyboard focus in its search field.
	private HandleDreamsFocusRequested(): void
	{
		const search = this.root.querySelector<HTMLInputElement>("[data-workspace-search]");
		search?.focus();
	}

	// Hides the Dream editor when the active Dream is closed.
	private HandleDreamClosed(): void
	{
		this.ClearIdeaSignalPreview();
		const editor = this.ideaStore.GetDraft() === null
			? null
			: "idea";
		this.ShowEditorPanel(editor);
	}

	// Reveals the Idea editor after catalogue selection or creation.
	private HandleIdeasChanged(): void
	{
		const draft = this.ideaStore.GetDraft();
		const pendingReference = this.ideaStore.GetPendingAddReference();

		if (draft !== null && pendingReference === null && this.dreamStore.GetActiveDream() === null)
		{
			this.ShowEditorPanel("idea");
			this.workspacePanel?.ActivateIdeaDocument();
		}
		else if (draft === null)
		{
			this.ClearIdeaSignalPreview();
			const ideaEditor = this.root.querySelector<HTMLElement>("[data-idea-editor-panel]");

			if (ideaEditor !== null && !ideaEditor.hasAttribute("hidden"))
			{
				this.ShowEditorPanel(null);
			}
		}
	}

	// Surfaces a reported error in a dismissible application popup.
	private HandleErrorReported(error: ErrorRecord): void
	{
		this.ShowError(error.userMessage ?? error.message);
	}

	// Starts work-specific Signal and Idea loading without blocking the initial workspace render.
	private HandleTextOpened(): void
	{
		const text = this.libraryStore.GetText();
		if (text !== null)
		{
			void this.LoadWorkDataAsync(text.id);
		}
	}

	// Loads work-specific records after the Library event has released the initial workspace.
	private async LoadWorkDataAsync(workId: string): Promise<void>
	{
		await this.signals.LoadAsync(workId);

		if (this.libraryStore.GetText()?.id === workId)
		{
			await this.dreams.RefreshAsync();
			await this.ideas.LoadAsync(workId);
		}
	}

	// Opens the unified select-or-create Ideas collection for one existing Signal.
	private async HandleIdeaAddSignalRequested(event: ChoraEvents["idea.add-signal-requested"]): Promise<void>
	{
		const reference = {
			signalId: event.signalId
		};

		if (event.ideaId === undefined)
		{
			this.ideas.BeginAddToIdea(reference);
		}
		else
		{
			await this.ideas.AddSignalToIdeaAsync(event.ideaId, reference);
		}
	}

	// Opens an Idea-referenced Signal in the real Dream editor while preserving Ideas and the reader.
	private async HandleIdeaSignalViewRequestedAsync(event: ChoraEvents["idea.signal-view-requested"]): Promise<void>
	{
		let signal = this.signalStore.GetSignal(event.signalId);

		if (signal === null)
		{
			for (const dream of this.dreamStore.GetCatalogue())
			{
				for (const candidate of dream.signals)
				{
					if (candidate.id === event.signalId)
					{
						signal = {
							...candidate,
							workId: dream.workId,
							createdAt: dream.createdAt,
							updatedAt: dream.updatedAt
						};
					}
				}
			}
		}

		if (signal !== null)
		{
			const selection = GetSignalAnchor(signal);
			if (this.libraryStore.GetText()?.id !== selection.documentId)
			{
				await this.library.OpenAsync(selection.documentId);
			}
			await this.events.PublishAsync("library.jump-requested", { selections: signal.selections });
		}
		else
		{
			this.errors.Report("ChoraApplication", new Error(`Signal does not exist: ${event.signalId}`), "Unable to open this Signal in the text.");
		}
	}

	// Restores the active Idea without rebuilding its discovery results.
	private HandleIdeaReturnRequested(): void
	{
		if (this.isIdeaSignalPreview && this.ideaStore.GetDraft() !== null)
		{
			this.ClearIdeaSignalPreview();
			this.ShowEditorPanel("idea");
			this.workspacePanel?.ActivateIdeaDocument();
		}
	}

	// Clears contextual Idea-preview navigation from the Dream header.
	private ClearIdeaSignalPreview(): void
	{
		this.isIdeaSignalPreview = false;
		this.workspacePanel?.SetIdeaReturnAvailable(false);
	}

	private HandleWorkspaceDocumentSelected(event: ChoraEvents["workspace.document-selected"]): void
	{
		this.ShowEditorPanel(event.kind);
	}

	// Returns the active Dream source used to enable exact source extension.
	private GetActiveDreamSource(): TextSelection | null
	{
		const source = this.dreamStore.GetActiveDream()?.source ?? null;

		return source;
	}

	// Opens a text selected in the main process's application menu or dock.
	private HandleTextSelected(textId: string): void
	{
		void this.library.OpenAsync(textId);
	}

	// Opens a text the main process loaded outside the Library catalogue lookup.
	private HandleExternalTextLoaded(text: TextDocument): void
	{
		this.library.OpenExternal(text);
	}

	// Refreshes the active Dream from disk when the window regains focus, in case it changed externally.
	private HandleWindowFocus(): void
	{
		if (this.dreamStore.GetActiveDream() === null) void this.dreams.RefreshAsync();
	}

	// Closes transient menus and saves pending work when the native window loses focus.
	private HandleWindowBlur(): void
	{
		this.CloseActionMenusOutside(null);
		void this.dreams.SaveAsync();
	}

	// Closes every open action menu except the one containing the new pointer or focus target.
	private CloseActionMenusOutside(target: Node | null): void
	{
		CloseOpenActionMenus(this.root, target);
	}

	// Displays a message in one dismissible application-wide error popup.
	private ShowError(message: string): void
	{
		this.CloseErrorPopup();
		this.errorPopup = new PopupPanel("Something went wrong");
		this.errorPopup.SetBodyHtml(`<p role="alert">${EscapeHtml(message)}</p>`);
		this.errorPopup.OnClose(this.CloseErrorPopup.bind(this));
		this.errorPopup.Open();
	}

	private CloseErrorPopup(): void
	{
		const popup = this.errorPopup;
		this.errorPopup = null;

		if (popup !== null)
		{
			popup.Close();
			popup.Dispose();
		}
	}

	// Shows one feature editor in the shared right pane.
	private ShowEditorPanel(editor: "dream" | "idea" | null): void
	{
		this.root.querySelector(".shell")?.classList.add("dream-open");
		this.root.querySelector<HTMLElement>("[data-editor-panel]")?.removeAttribute("hidden");
		this.root.querySelector<HTMLElement>("[data-editor-empty]")?.toggleAttribute("hidden", editor !== null);
		this.root.querySelector<HTMLElement>("[data-dream-panel]")?.toggleAttribute("hidden", editor !== "dream");
		this.root.querySelector<HTMLElement>("[data-idea-editor-panel]")?.toggleAttribute("hidden", editor !== "idea");
	}

	// Begins tracking a pane-resize drag started from a resize handle.
	private HandlePanelResizePointerDown(event: PointerEvent): void
	{
		const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-pane]");
		const pane = handle?.dataset.resizePane;
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const panel = pane === "left" ? this.root.querySelector<HTMLElement>(".left-panel") : this.root.querySelector<HTMLElement>(".right-panel");

		if ((pane === "left" || pane === "dream") && shell !== null && panel !== null)
		{
			event.preventDefault();
			handle?.classList.add("is-active");
			this.activeResizablePane = pane;
			this.resizeStartX = event.clientX;
			this.resizeStartWidth = panel.getBoundingClientRect().width;
			shell.classList.add("is-resizing");
			window.addEventListener("pointermove", this.panelResizePointerMoveHandler);
			window.addEventListener("pointerup", this.panelResizePointerUpHandler, { once: true });
		}
	}

	// Resizes the dragged pane, clamped so both the reader and the other pane stay usable.
	private HandlePanelResizePointerMove(event: PointerEvent): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const leftPanel = this.root.querySelector<HTMLElement>(".left-panel");

		if (shell !== null && leftPanel !== null && this.activeResizablePane !== null)
		{
			const shellWidth = shell.getBoundingClientRect().width;
			const delta = event.clientX - this.resizeStartX;
			const leftWidth = leftPanel.getBoundingClientRect().width;
			const isDreamOpen = shell.classList.contains("dream-open");
			const compactLayout = shellWidth <= 760;
			const minimumLeftWidth = compactLayout ? 170 : 220;
			const minimumDreamWidth = compactLayout ? 240 : 300;
			const minimumReaderWidth = compactLayout ? 220 : 320;
			let width = this.resizeStartWidth + delta;

			if (this.activeResizablePane === "left")
			{
				const isCollapsed = shell.classList.contains("left-collapsed");

				if (isCollapsed && delta > 0)
				{
					shell.classList.remove("left-collapsed");
					shell.style.setProperty("--left-pane-width", `${minimumLeftWidth}px`);
					this.resizeStartX = event.clientX;
					this.resizeStartWidth = minimumLeftWidth;
				}
				else if (width < 140)
				{
					this.CollapseLeftPane(shell);
				}
				else
				{
					shell.classList.remove("left-collapsed");
					const maximumWidth = shellWidth - minimumReaderWidth - (isDreamOpen ? minimumDreamWidth : 0);
					const clampedWidth = Math.max(minimumLeftWidth, Math.min(width, maximumWidth));
					shell.style.setProperty("--left-pane-width", `${clampedWidth}px`);
				}
			}
			else
			{
				const maximumWidth = shellWidth - leftWidth - minimumReaderWidth;
				width = Math.max(minimumDreamWidth, Math.min(width, maximumWidth));
				shell.style.setProperty("--dream-pane-width", `${width}px`);
			}
		}
	}

	// Keeps all three workspace columns visible after a native-window resize.
	private NormalizePanelWidths(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const leftPanel = this.root.querySelector<HTMLElement>(".left-panel");
		const dreamPanel = this.root.querySelector<HTMLElement>(".right-panel");

		if (shell !== null && leftPanel !== null && dreamPanel !== null && !shell.classList.contains("left-collapsed"))
		{
			const shellWidth = shell.getBoundingClientRect().width;
			const compactLayout = shellWidth <= 760;
			const minimumLeftWidth = compactLayout ? 170 : 220;
			const minimumDreamWidth = compactLayout ? 240 : 300;
			const minimumReaderWidth = compactLayout ? 220 : 320;
			const maximumLeftWidth = shellWidth - minimumDreamWidth - minimumReaderWidth;
			const leftWidth = Math.max(minimumLeftWidth, Math.min(leftPanel.getBoundingClientRect().width, maximumLeftWidth));
			const maximumDreamWidth = shellWidth - leftWidth - minimumReaderWidth;
			const dreamWidth = Math.max(minimumDreamWidth, Math.min(dreamPanel.getBoundingClientRect().width, maximumDreamWidth));
			shell.style.setProperty("--left-pane-width", `${leftWidth}px`);
			shell.style.setProperty("--dream-pane-width", `${dreamWidth}px`);
		}
	}

	// Restores durable workspace widths and Explorer collapse state before feature panels mount.
	private ApplyPersistedLayout(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const leftPanel = this.root.querySelector<HTMLElement>(".left-panel");
		const editorPanel = this.root.querySelector<HTMLElement>(".right-panel");

		if (shell !== null && leftPanel !== null && editorPanel !== null)
		{
			const leftWidth = LayoutSettings.GetDimension("leftPaneWidth", leftPanel.getBoundingClientRect().width);
			const editorWidth = LayoutSettings.GetDimension("editorPaneWidth", editorPanel.getBoundingClientRect().width);
			shell.style.setProperty("--left-pane-width", `${leftWidth}px`);
			shell.style.setProperty("--dream-pane-width", `${editorWidth}px`);
			if (LayoutSettings.GetExplorerCollapsed()) this.CollapseLeftPane(shell);
		}
	}

	// Leaves workspace navigation accessible when the left pane is collapsed.
	private CollapseLeftPane(shell: HTMLElement): void
	{
		shell.style.setProperty("--left-collapsed-width", "90px");
		shell.classList.add("left-collapsed");
		LayoutSettings.SetExplorerCollapsed(true);
	}

	// Restores the Explorer and focuses the requested workspace folder.
	private ExpandLeftPane(kind: "dream" | "idea"): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");

		if (shell !== null)
		{
			shell.classList.remove("left-collapsed");
			const currentWidth = Number.parseFloat(shell.style.getPropertyValue("--left-pane-width"));
			if (!Number.isFinite(currentWidth) || currentWidth < 220) shell.style.setProperty("--left-pane-width", "220px");
			const restoredWidth = Number.parseFloat(shell.style.getPropertyValue("--left-pane-width"));
			LayoutSettings.SetExplorerCollapsed(false);
			LayoutSettings.SetDimension("leftPaneWidth", restoredWidth);
			this.workspacePanel?.FocusExplorerSection(kind);
		}
	}

	// Ends a pane-resize drag and releases its pointer listeners.
	private StopPanelResize(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		this.activeResizablePane = null;
		window.removeEventListener("pointermove", this.panelResizePointerMoveHandler);
		window.removeEventListener("pointerup", this.panelResizePointerUpHandler);
		shell?.classList.remove("is-resizing");
		const handles = this.root.querySelectorAll<HTMLElement>(".panel-resize-handle.is-active");
		for (const handle of Array.from(handles)) handle.classList.remove("is-active");
		const leftWidth = this.root.querySelector<HTMLElement>(".left-panel")?.getBoundingClientRect().width;
		const editorWidth = this.root.querySelector<HTMLElement>(".right-panel")?.getBoundingClientRect().width;
		if (leftWidth !== undefined && !shell?.classList.contains("left-collapsed")) LayoutSettings.SetDimension("leftPaneWidth", leftWidth);
		if (editorWidth !== undefined) LayoutSettings.SetDimension("editorPaneWidth", editorWidth);
	}

	// Routes application-level reading-setting controls to their workflows.
	private HandleLeftViewClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const explorerKind = target?.closest<HTMLElement>("[data-expand-explorer]")?.dataset.expandExplorer;
		const appearanceButton = target?.closest<HTMLElement>("[data-toggle-appearance]");
		const fontStep = target?.closest<HTMLElement>("[data-font-size]")?.dataset.fontSize;

		if (explorerKind === "dream" || explorerKind === "idea")
		{
			this.ExpandLeftPane(explorerKind);
		}

		if (appearanceButton != null)
		{
			this.ToggleAppearance();
		}

		if (fontStep !== undefined)
		{
			this.ChangeFontSize(Number.parseInt(fontStep, 10));
		}

	}

	// Applies a change to the reading-font selector.
	private HandleSettingsChange(event: Event): void
	{
		const target = event.target as HTMLSelectElement | null;

		if (target?.matches("[data-reading-font]") === true)
		{
			this.settings.SetFont(target.value as ReadingFont);
		}
	}

	// Applies a font-size step and reflects the new value in the toolbar.
	private ChangeFontSize(delta: number): void
	{
		this.settings.ChangeFontSize(delta);
		const value = this.root.querySelector<HTMLElement>("[data-font-size-value]");
		if (value !== null) value.textContent = String(this.settings.GetFontSize());
	}

	// Toggles light/dark appearance and reflects the current theme in reading settings.
	private ToggleAppearance(): void
	{
		this.settings.ToggleAppearance();
		const button = this.root.querySelector<HTMLElement>("[data-toggle-appearance]");
		const value = button?.querySelector<HTMLElement>("[data-appearance-value]");
		const isLight = this.settings.GetAppearance() === "light";
		const label = isLight ? "Use dark appearance" : "Use light appearance";

		if (button !== null)
		{
			button.title = label;
			button.setAttribute("aria-label", label);
		}
		if (value !== null && value !== undefined) value.textContent = isLight ? "Light" : "Dark";
	}

	// Handles the Dream-creation and Dream-save keyboard shortcuts.
	private async HandleKeyDownAsync(event: KeyboardEvent): Promise<void>
	{
		const hasCommandModifier = event.ctrlKey || event.metaKey;
		const target = event.target as HTMLElement | null;
		const isEditable = target?.matches("input, textarea, [contenteditable=true]") ?? false;
		if (event.key === "Escape")
		{
			const nodes = this.root.querySelectorAll<HTMLDetailsElement>(".action-menu[open]");
			const menus = Array.from(nodes);
			for (const menu of menus)
			{
				menu.open = false;
				menu.querySelector<HTMLElement>("summary")?.focus();
			}
		}

		if (hasCommandModifier && event.key.toLowerCase() === "d" && !isEditable)
		{
			const selection = this.libraryStore.GetSelection();
			if (selection !== null) await this.dreams.Create(selection);
		}

		if (hasCommandModifier && event.key === "Enter" && this.dreamStore.GetActiveDream() !== null)
		{
			event.preventDefault();
			await this.dreams.SaveAsync();
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

window.addEventListener("DOMContentLoaded", () =>
{
	const root = document.getElementById("app");

	if (root !== null)
	{
		const application = new ChoraApplication(root);
		window.addEventListener("beforeunload", () => application.Dispose(), { once: true });
		void application.StartAsync();
	}
});
