import type { DreamView } from "../dreams/DreamView.js";
import type { IdeaDiscoverySuggestion, IdeaRecord, IdeaSignalReference } from "../../shared/ideas/IdeaTypes.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { DreamStore } from "../dreams/DreamStore.js";
import { AddIcon, CloseIcon, SearchIcon } from "../ui/Icons.js";
import { NormalizeDisplayText } from "../ui/DisplayText.js";
import { EscapeHtml } from "../ui/Html.js";
import { RenderProgressBar } from "../ui/ProgressBar.js";
import { IdeaController } from "./IdeaController.js";
import { IdeaStore, type IdeaDraft } from "./IdeaStore.js";
import { SignalDocumentPanel } from "../signals/SignalDocumentPanel.js";
import type { SignalController } from "../signals/SignalController.js";
import type { SignalStore } from "../signals/SignalStore.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { IdeaSignalsPanel, type IdeaSignalViewOwner } from "./IdeaSignalsPanel.js";
import type { SignalViewRecord } from "../signals/SignalViewPanel.js";
import { IdeaSeeingPanel } from "./IdeaSeeingPanel.js";
import { TabControl } from "../ui/TabControl.js";

// Which view of the Ideas feature this panel instance renders.
export type IdeaPanelMode = "catalogue" | "editor";

// Contains one Signal and the DreamView that owns it for display.
export interface ResolvedIdeaSignal
{
	// Contains the owning DreamView.
	readonly dream: DreamView | null;
	// Contains the referenced Signal.
	readonly signal: SignalRecord;
}

// Renders the flat Ideas catalogue or active Idea editor and routes browser events.
export class IdeaPanel extends SignalDocumentPanel implements IdeaSignalViewOwner
{
	// Contains subscriptions released with this panel.
	private readonly subscriptions: Unsubscribe[] = [];
	// Handles all delegated click events from the persistent panel root.
	private readonly clickHandler: (event: Event) => void;
	// Handles all delegated input events from the persistent panel root.
	private readonly inputHandler: (event: Event) => void;
	// Renders feature state after typed application events.
	private readonly updateHandler: () => void;
	// Reports shared Signal editor failures.
	private readonly errors: ErrorManager;
	// Owns the shared Signal list/detail presentation.
	private ideaSignalsPanel: IdeaSignalsPanel | null = null;
	// Owns the full-height Seeing editor.
	private ideaSeeingPanel: IdeaSeeingPanel | null = null;
	// Owns persistent Signals and Seeing tabs.
	private ideaTabs: TabControl | null = null;
	// Remembers the selected inner tab for each open Idea.
	private readonly selectedIdeaTabs = new Map<string, string>();
	// Identifies the Idea currently represented by the inner tabs.
	private mountedIdeaKey: string | null = null;
	// Remembers the selected Signal while the active Idea remains mounted.
	private selectedIdeaSignalId: string | null = null;

	// Creates one persistent Ideas panel mode and registers delegated events once.
	public constructor(
		private readonly root: HTMLElement,
		events: ChoraEventBus<ChoraEvents>,
		private readonly store: IdeaStore,
		private readonly controller: IdeaController,
		private readonly dreams: DreamStore,
		private readonly mode: IdeaPanelMode,
		signals: SignalStore | null = null,
		signalController: SignalController | null = null)
	{
		super(root, events, signals, signalController);
		this.errors = new ErrorManager(events);
		this.clickHandler = this.HandleClick.bind(this);
		this.inputHandler = this.HandleInput.bind(this);
		this.updateHandler = this.Update.bind(this);
		this.root.addEventListener("click", this.clickHandler);
		this.root.addEventListener("input", this.inputHandler);
		const ideaSubscription = events.Subscribe("ideas.changed", this.updateHandler);
		const dreamSubscription = events.Subscribe("dream.catalogue-changed", this.updateHandler);
		const signalSubscription = events.Subscribe("signal.changed", this.HandleSignalChanged.bind(this));
		const signalFocusSubscription = events.Subscribe("idea.signal-focus-requested", this.HandleSignalFocusRequestedAsync.bind(this));
		this.subscriptions.push(ideaSubscription);
		this.subscriptions.push(dreamSubscription);
		this.subscriptions.push(signalSubscription);
		this.subscriptions.push(signalFocusSubscription);
		this.Update();
	}

	// Releases event-bus subscriptions owned by this panel.
	public Dispose(): void
	{
		this.DisposeSignalDocumentPanel();
		this.DisposeIdeaTabs();
		this.root.removeEventListener("click", this.clickHandler);
		this.root.removeEventListener("input", this.inputHandler);

		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
	}

	// Returns the Signal selected in the active Idea.
	public GetSelectedIdeaSignal(): string | null
	{
		const signalId = this.selectedIdeaSignalId;

		return signalId;
	}

	// Remembers the Signal selected in the active Idea.
	public RememberSelectedIdeaSignal(signalId: string | null): void
	{
		this.selectedIdeaSignalId = signalId;
	}

	// Opens work-wide Signal discovery from the shared Signal rail.
	public OpenIdeaSignalBrowser(): void
	{
		this.controller.OpenSignalBrowser();
	}

	// Refreshes one canonical Signal without replacing the active Idea editor.
	private HandleSignalChanged(event: ChoraEvents["signal.changed"]): void
	{
		this.ideaSignalsPanel?.RefreshSignal(event.signal);
	}

	// Reveals the exact Signal selected from the reading text.
	private async HandleSignalFocusRequestedAsync(event: ChoraEvents["idea.signal-focus-requested"]): Promise<void>
	{
		const draft = this.store.GetDraft();
		const matchesIdea = draft !== null && (event.ideaId === null || draft.ideaId === event.ideaId);

		if (matchesIdea)
		{
			const ideaKey = draft.ideaId ?? "new";
			this.selectedIdeaSignalId = event.signalId;
			this.selectedIdeaTabs.set(ideaKey, "signals");
			this.ideaTabs?.Select("signals");
			await this.ideaSignalsPanel?.ShowSignalAsync(event.signalId);
		}
	}

	// Returns whether this instance represents the active Idea editor.
	protected CanAssociateSignal(): boolean
	{
		return this.mode === "editor" && this.store.GetDraft() !== null;
	}

	// Connects one work-owned Signal to the active Idea.
	protected async AssociateSignalAsync(signal: SignalRecord): Promise<void>
	{
		this.controller.AddSignal({ signalId: signal.id });
		await Promise.resolve();
	}

	// Resolves one Signal reference against renderer DreamView snapshots.
	public ResolveSignal(reference: IdeaSignalReference): ResolvedIdeaSignal | null
	{
		const dreams = this.dreams.GetCatalogue();
		let resolvedDream: DreamView | null = null;
		let resolvedSignal: SignalRecord | null = this.signalStore?.GetSignal(reference.signalId) ?? null;

		for (const dream of dreams)
		{
			if (resolvedSignal === null && dream.signals.some((signal) => signal.id === reference.signalId))
			{
				resolvedDream = dream;
			}
		}
		if (resolvedDream !== null)
		{
			for (const signal of resolvedDream.signals)
			{
				if (signal.id === reference.signalId)
				{
					resolvedSignal = signal;
				}
			}
		}

		let resolved: ResolvedIdeaSignal | null = null;

		if (resolvedSignal !== null)
		{
			resolved = {
				dream: resolvedDream,
				signal: resolvedSignal
			};
		}

		return resolved;
	}

	// Re-renders the panel mode from the current store snapshot.
	private Update(): void
	{
		if (this.mode === "catalogue")
		{
			this.DisposeIdeaTabs();
			this.root.innerHTML = this.RenderCatalogue();
		}
		else
		{
			const draft = this.store.GetDraft();

			if (draft === null)
			{
				this.DisposeIdeaTabs();
				this.root.replaceChildren();
			}
			else if (this.store.GetView() === "suggestions" || this.store.GetView() === "signals")
			{
				this.DisposeIdeaTabs();
				this.root.innerHTML = this.RenderSignalBrowser(draft);
			}
			else
			{
				this.DisposeIdeaTabs();
				this.root.innerHTML = this.RenderEditor(draft);
				this.MountIdeaTabs(draft);
			}
		}
	}

	// Renders the Dreams-style flat Ideas catalogue.
	private RenderCatalogue(): string
	{
		const pendingReference = this.store.GetPendingAddReference();
		const cancel = pendingReference === null
			? ""
			: `<button class="catalogue-header-button button-control" data-cancel-add-to-idea type="button" title="Cancel Add to Idea" aria-label="Cancel Add to Idea">${CloseIcon}</button>`;
		const markup = `<section class="idea-catalogue dream-catalogue left-tab-panel"><div class="dream-catalogue-controls"><label class="dream-search">${SearchIcon}<input data-idea-search type="search" aria-label="Search Ideas" placeholder="Search ideas..." value="${EscapeHtml(this.store.GetCatalogueSearch())}"></label><button class="catalogue-header-button button-control" data-new-idea type="button" title="New Idea" aria-label="New Idea">${AddIcon}</button>${cancel}</div><div class="dream-catalogue-list idea-catalogue-list">${this.RenderCatalogueContent()}</div></section>`;

		return markup;
	}

	// Renders matching Ideas as one ungrouped catalogue list.
	private RenderCatalogueContent(): string
	{
		const ideas = this.store.GetIdeas();
		const search = this.NormalizeSearch(this.store.GetCatalogueSearch());
		let content = search.length > 0
			? `<p class="dream-empty">No matching Ideas.</p>`
			: `<p class="dream-empty">No Ideas yet.</p>`;
		let rows = "";

		for (const idea of ideas)
		{
			if (this.MatchesIdeaSearch(idea, search))
			{
				rows += this.RenderCatalogueItem(idea);
			}
		}

		if (rows.length > 0)
		{
			content = rows;
		}

		return content;
	}

	// Renders one Idea using the established Dreams catalogue row.
	private RenderCatalogueItem(idea: IdeaRecord): string
	{
		const draft = this.store.GetDraft();
		const pendingReference = this.store.GetPendingAddReference();
		const isActive = draft?.ideaId === idea.id;
		const isConnected = pendingReference !== null && this.ContainsSignal(idea, pendingReference);
		const count = idea.relatedSignals.length + (idea.originSignal === null ? 0 : 1);
		const countLabel = count === 1
			? "1 Signal"
			: `${count} Signals`;
		const location = isConnected
			? `${countLabel} · Connected`
			: countLabel;
		const disabled = isConnected
			? " disabled"
			: "";
		const title = idea.title || "Untitled Idea";
		const markup = `<button class="catalogue-item button-control${isActive ? " selected" : ""}" type="button" data-idea-id="${EscapeHtml(idea.id)}" aria-current="${isActive ? "true" : "false"}"${disabled}><span class="catalogue-item-copy"><strong>${EscapeHtml(NormalizeDisplayText(title))}</strong><span class="catalogue-location">${location}</span></span></button>`;

		return markup;
	}

	// Determines whether one Idea matches the current catalogue query.
	private MatchesIdeaSearch(idea: IdeaRecord, search: string): boolean
	{
		let searchable = `${idea.title} ${idea.content}`;
		const references = idea.originSignal === null
			? [...idea.relatedSignals]
			: [idea.originSignal, ...idea.relatedSignals];

		for (const reference of references)
		{
			const resolved = this.ResolveSignal(reference);

			if (resolved !== null)
			{
				const locator = this.CreateSignalLocator(resolved.signal);
				const context = resolved.dream === null
					? resolved.signal.selection.documentId
					: `${resolved.dream.title} ${resolved.dream.dialogue ?? resolved.dream.workId}`;
				searchable += ` ${context} ${resolved.signal.text} ${resolved.signal.description} ${locator}`;
			}
		}

		const normalized = this.NormalizeSearch(searchable);
		const matches = search.length === 0 || normalized.includes(search);

		return matches;
	}

	// Renders the active Idea editor.
	private RenderEditor(draft: IdeaDraft): string
	{
		const saveDisabled = "";
		const error = this.store.GetError();
		const errorMarkup = error === null
			? ""
			: `<p class="idea-error" role="alert">${EscapeHtml(error)}</p>`;
		const escapedTitle = EscapeHtml(NormalizeDisplayText(draft.title));
		const markup = `<section class="idea-panel idea-editor-panel"><div class="idea-workspace"><section class="idea-editor document-editor" aria-label="Idea draft"><section class="idea-interpretation document-interpretation"><label><span>Title</span><input data-idea-title value="${escapedTitle}" placeholder="Name this Idea"></label></section><section class="idea-signals-section document-signals-section" aria-label="Idea content"><div class="idea-tabs-host document-signal-view-host" data-idea-tabs></div></section>${errorMarkup}<footer class="idea-editor-actions document-editor-actions"><div class="document-save-actions"><button class="document-save-button button-control idea-save-button" data-save-idea type="button" aria-label="Save Idea"${saveDisabled}>Save</button></div></footer></section></div></section>`;

		return markup;
	}

	// Mounts persistent Signals and Seeing tabs for the active Idea.
	private MountIdeaTabs(draft: IdeaDraft): void
	{
		const host = this.root.querySelector<HTMLElement>("[data-idea-tabs]");

		if (host !== null)
		{
			const ideaKey = draft.ideaId ?? "new";
			const selectedTab = this.selectedIdeaTabs.get(ideaKey) ?? "signals";
			const signals: SignalViewRecord[] = [];
			const references = draft.originSignal === null
				? [...draft.relatedSignals]
				: [draft.originSignal, ...draft.relatedSignals];

			for (const reference of references)
			{
				const resolved = this.ResolveSignal(reference);

				if (resolved !== null) signals.push(resolved.signal);
			}

			this.ideaSignalsPanel = new IdeaSignalsPanel(
				this.controller,
				this.signalController,
				this,
				this.errors);
			this.ideaSeeingPanel = new IdeaSeeingPanel(this.controller, draft.content, this.errors);
			this.mountedIdeaKey = ideaKey;
			this.ideaTabs = new TabControl(
				[this.ideaSignalsPanel, this.ideaSeeingPanel],
				"Idea content",
				this.HandleIdeaTabSelected.bind(this));
			this.ideaTabs.Select(selectedTab);
			const tabList = this.ideaTabs.Root.querySelector<HTMLElement>(".tab-list");

			if (tabList !== null) this.ideaSignalsPanel.AttachAddSignalAction(tabList);
			host.append(this.ideaTabs.Root);
			this.ideaSignalsPanel.Update(signals);
		}
	}

	// Remembers the active Idea content tab.
	private HandleIdeaTabSelected(tabId: string): void
	{
		if (this.mountedIdeaKey !== null) this.selectedIdeaTabs.set(this.mountedIdeaKey, tabId);
	}

	// Releases the active Idea's Signals and Seeing tabs.
	private DisposeIdeaTabs(): void
	{
		this.ideaTabs?.Dispose();
		this.ideaTabs = null;
		this.ideaSignalsPanel = null;
		this.ideaSeeingPanel = null;
		this.mountedIdeaKey = null;
	}

	// Renders the searchable browser used to connect several existing Signals.
	private RenderSignalBrowser(draft: IdeaDraft): string
	{
		const usesAi = this.store.GetView() === "suggestions";
		const hasDescription = draft.title.trim().length > 0 || draft.content.trim().length > 0;
		const search = EscapeHtml(this.store.GetSignalSearch());
		const results = usesAi
			? this.RenderSuggestionResults(draft)
			: this.RenderAvailableSignals(draft);
		const aiDisabled = hasDescription ? "" : " disabled";
		const aiTitle = hasDescription
			? "Use AI to find related Signals"
			: "Describe the Idea before using AI";
		const searchDisabled = usesAi ? " disabled" : "";
		const checked = usesAi ? " checked" : "";
		const markup = `<section class="idea-panel idea-editor-panel"><header class="idea-editor-header"><h2>Find Signals</h2><button class="button-control idea-view-action" data-show-idea-editor type="button">Done</button></header><div class="idea-signal-browser"><div class="idea-signal-search-controls"><label class="application-find">${SearchIcon}<input data-signal-search type="search" aria-label="Search Signals" placeholder="Search signals..." value="${search}"${searchDisabled}></label><label class="idea-ai-toggle" title="${aiTitle}"><input data-toggle-ai type="checkbox" aria-label="Use AI"${checked}${aiDisabled}><span>Use AI</span></label></div><div class="signal-list idea-signal-browser-results" data-signal-results>${results}</div></div></section>`;

		return markup;
	}

	// Renders model-assisted suggestions within the unified Signal browser.
	private RenderSuggestionResults(draft: IdeaDraft): string
	{
		const state = this.store.GetDiscoveryState();
		const suggestions = this.store.GetSuggestions();
		let results = "";

		if (state === "loading")
		{
			results = `<div class="idea-discovery-loading"><p class="dream-empty" role="status">Finding Signals...</p>${RenderProgressBar("Finding Signals")}</div>`;
		}
		else if (state === "error")
		{
			results = `<p class="idea-error" role="alert">Unable to find Signals with the model. Manual search remains available.</p>`;
		}
		else if (suggestions.length === 0)
		{
			results = `<p class="dream-empty" role="status">No strong Signal connections found.</p>`;
		}
		else
		{
			for (const suggestion of suggestions)
			{
				results += this.RenderSuggestion(draft, suggestion);
			}
		}

		return results;
	}

	// Renders one existing suggested Signal with a concise model rationale.
	private RenderSuggestion(draft: IdeaDraft, suggestion: IdeaDiscoverySuggestion): string
	{
		const resolved = this.ResolveSignal(suggestion.reference);
		let markup = "";

		if (resolved !== null)
		{
			const dream = resolved.dream;
			const signal = resolved.signal;
			const isConnected = this.ContainsDraftSignal(draft, suggestion.reference);
			const state = isConnected
				? "Connected"
				: "Add";
			const disabled = isConnected
				? " disabled"
				: "";
			const locator = this.CreateSignalLocator(signal);
			const context = dream === null
				? `${signal.selection.documentId} · ${locator}`
				: `${dream.title || "Untitled Dream"} · ${dream.dialogue ?? dream.workId} · ${locator}`;
			const dreamId = EscapeHtml(dream?.id ?? "");
			const signalId = EscapeHtml(signal.id);
			const escapedState = EscapeHtml(state);
			const rationale = EscapeHtml(NormalizeDisplayText(suggestion.rationale));
			markup = `<section class="signal-item idea-suggestion"><div class="signal-header"><button class="signal-row button-control" data-view-available="${dreamId}" data-signal-id="${signalId}" type="button"><strong class="signal-heading">${EscapeHtml(NormalizeDisplayText(signal.text))}<span>${EscapeHtml(NormalizeDisplayText(context))}</span></strong></button><button class="dream-icon-button button-control" data-add-available="${dreamId}" data-signal-id="${signalId}" type="button" title="${escapedState}" aria-label="${escapedState}"${disabled}>${AddIcon}</button></div><p class="idea-suggestion-rationale">${rationale}</p></section>`;
		}

		return markup;
	}

	// Renders every matching Signal from the active work as one flat list.
	private RenderAvailableSignals(draft: IdeaDraft): string
	{
		const dreams = this.dreams.GetCatalogue();
		const search = this.NormalizeSearch(this.store.GetSignalSearch());
		let results = "";

		for (const signal of this.signalStore?.GetSignals() ?? [])
		{
			if (signal.workId === draft.workId && this.MatchesWorkSignalSearch(signal, search))
			{
				results += this.RenderWorkSignal(draft, signal);
			}
		}

		for (const dream of this.signalStore === null ? dreams : [])
		{
			if (dream.workId === draft.workId)
			{
				for (const signal of dream.signals)
				{
					if (this.MatchesSignalSearch(dream, signal, search))
					{
						results += this.RenderAvailableSignal(draft, dream, signal);
					}
				}
			}
		}

		if (results.length === 0)
		{
			results = `<p class="dream-empty">No matching Signals.</p>`;
		}

		return results;
	}

	// Renders one work-owned Signal-browser row.
	private RenderWorkSignal(draft: IdeaDraft, signal: SignalRecord): string
	{
		const reference: IdeaSignalReference = { signalId: signal.id };
		const isConnected = this.ContainsDraftSignal(draft, reference);
		const state = isConnected ? "Connected" : "Add";
		const disabled = isConnected ? " disabled" : "";
		const locator = this.CreateSignalLocator(signal);
		const signalId = EscapeHtml(signal.id);
		const context = `${signal.workId} · ${locator}`;
		const markup = `<section class="signal-item"><div class="signal-header"><button class="signal-row button-control" data-view-available data-signal-id="${signalId}" type="button"><strong class="signal-heading">${EscapeHtml(NormalizeDisplayText(signal.text))}<span>${EscapeHtml(NormalizeDisplayText(context))}</span></strong></button><button class="dream-icon-button button-control" data-add-available data-signal-id="${signalId}" type="button" title="${state}" aria-label="${state}"${disabled}>${AddIcon}</button></div></section>`;

		return markup;
	}

	// Determines whether one work-owned Signal matches the current browser query.
	private MatchesWorkSignalSearch(signal: SignalRecord, search: string): boolean
	{
		const locator = this.CreateSignalLocator(signal);
		const normalized = this.NormalizeSearch(`${signal.text} ${signal.description} ${locator}`);
		const matches = search.length === 0 || normalized.includes(search);

		return matches;
	}

	// Renders one Signal-browser row with separate inspection and connection actions.
	private RenderAvailableSignal(draft: IdeaDraft, dream: DreamView, signal: SignalRecord): string
	{
		const reference: IdeaSignalReference = {
			signalId: signal.id
		};
		const isConnected = this.ContainsDraftSignal(draft, reference);
		const state = isConnected
			? "Connected"
			: "Add";
		const disabled = isConnected
			? " disabled"
			: "";
		const locator = this.CreateSignalLocator(signal);
		const context = `${dream.title || "Untitled Dream"} · ${dream.dialogue ?? dream.workId} · ${locator}`;
		const dreamId = EscapeHtml(dream.id);
		const signalId = EscapeHtml(signal.id);
		const escapedState = EscapeHtml(state);
		const markup = `<section class="signal-item"><div class="signal-header"><button class="signal-row button-control" data-view-available="${dreamId}" data-signal-id="${signalId}" type="button"><strong class="signal-heading">${EscapeHtml(NormalizeDisplayText(signal.text))}<span>${EscapeHtml(NormalizeDisplayText(context))}</span></strong></button><button class="dream-icon-button button-control" data-add-available="${dreamId}" data-signal-id="${signalId}" type="button" title="${escapedState}" aria-label="${escapedState}"${disabled}>${AddIcon}</button></div></section>`;

		return markup;
	}

	// Determines whether one Signal matches the current browser query.
	private MatchesSignalSearch(dream: DreamView, signal: SignalRecord, search: string): boolean
	{
		const locator = this.CreateSignalLocator(signal);
		const searchable = `${dream.title} ${dream.dialogue ?? dream.workId} ${signal.text} ${signal.description} ${locator}`;
		const normalized = this.NormalizeSearch(searchable);
		const matches = search.length === 0 || normalized.includes(search);

		return matches;
	}

	// Identifies whether one Signal is already connected to the active draft.
	private ContainsDraftSignal(draft: IdeaDraft, reference: IdeaSignalReference): boolean
	{
		const identity = this.CreateReferenceIdentity(reference);
		const originIdentity = draft.originSignal === null
			? null
			: this.CreateReferenceIdentity(draft.originSignal);
		let isIncluded = identity === originIdentity;

		for (const candidate of draft.relatedSignals)
		{
			const candidateIdentity = this.CreateReferenceIdentity(candidate);

			if (candidateIdentity === identity)
			{
				isIncluded = true;
			}
		}

		return isIncluded;
	}

	// Returns the most precise displayed source location for one Signal.
	private CreateSignalLocator(signal: SignalRecord | undefined): string
	{
		const start = signal?.sourceRef.trim() || null;
		const end = start;
		let locator = "Source";

		if (start !== null && end !== null && start !== end)
		{
			locator = `${start}-${end}`;
		}
		else if (start !== null)
		{
			locator = start;
		}
		else if (end !== null)
		{
			locator = end;
		}

		return locator;
	}

	// Determines whether one durable Idea already contains one Signal.
	private ContainsSignal(idea: IdeaRecord, reference: IdeaSignalReference): boolean
	{
		const identity = this.CreateReferenceIdentity(reference);
		const originIdentity = idea.originSignal === null ? null : this.CreateReferenceIdentity(idea.originSignal);
		let isIncluded = originIdentity !== null && identity === originIdentity;

		for (const candidate of idea.relatedSignals)
		{
			const candidateIdentity = this.CreateReferenceIdentity(candidate);

			if (candidateIdentity === identity)
			{
				isIncluded = true;
			}
		}

		return isIncluded;
	}

	// Creates the stable identity used to compare Signal references.
	private CreateReferenceIdentity(reference: IdeaSignalReference): string
	{
		const identity = `signal:${reference.signalId}`;

		return identity;
	}

	// Normalizes user-authored text for case-insensitive catalogue matching.
	private NormalizeSearch(value: string): string
	{
		const normalized = value.normalize("NFC").trim().toLocaleLowerCase();

		return normalized;
	}

	// Routes input changes to catalogue filtering, Signal filtering, or draft editing.
	private HandleInput(event: Event): void
	{
		const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;

		if (target?.matches("[data-idea-search]") === true)
		{
			this.store.SetCatalogueSearch(target.value);
			const list = this.root.querySelector<HTMLElement>(".idea-catalogue-list");

			if (list !== null)
			{
				list.innerHTML = this.RenderCatalogueContent();
			}
		}
		else if (target instanceof HTMLInputElement && target.matches("[data-toggle-ai]"))
		{
			if (target.checked)
			{
				const discovery = this.controller.FindSignalsAsync();
				void discovery;
			}
			else
			{
				this.controller.OpenSignalBrowser();
			}
		}
		else if (target?.matches("[data-signal-search]") === true)
		{
			this.controller.UpdateSignalSearch(target.value);
			const draft = this.store.GetDraft();
			const results = this.root.querySelector<HTMLElement>("[data-signal-results]");

			if (draft !== null && results !== null)
			{
				results.innerHTML = this.RenderAvailableSignals(draft);
			}
		}
		else if (target?.matches("[data-idea-title]") === true)
		{
			this.controller.UpdateTitle(target.value);
		}
	}

	// Routes delegated browser clicks into typed Idea workflows.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;

		if (target !== null)
		{
			const ideaId = target.closest<HTMLElement>("[data-idea-id]")?.dataset.ideaId;
			const availableView = target.closest<HTMLElement>("[data-view-available]");
			const availableAdd = target.closest<HTMLElement>("[data-add-available]");
			const connectedView = target.closest<HTMLElement>("[data-view-connected-signal]");
			const signalRemoval = target.closest<HTMLElement>("[data-remove-idea-signal]");

			if (ideaId !== undefined)
			{
				const pendingReference = this.store.GetPendingAddReference();

				if (pendingReference === null)
				{
					this.controller.Edit(ideaId);
				}
				else
				{
					const addition = this.controller.AddPendingSignalToIdeaAsync(ideaId);
					void addition;
				}
			}
			if (target.closest("[data-new-idea]") !== null)
			{
				const pendingReference = this.store.GetPendingAddReference();
				const creation = pendingReference === null
					? this.controller.CreateAsync()
					: this.controller.CreateIdeaFromPendingSignalAsync();
				void creation;
			}
			if (target.closest("[data-cancel-add-to-idea]") !== null)
			{
				this.controller.CancelAddToIdea();
			}
			if (target.closest("[data-open-signal-browser]") !== null)
			{
				this.controller.OpenSignalBrowser();
			}
			if (target.closest("[data-show-idea-editor]") !== null)
			{
				this.controller.ShowEditor();
			}
			if (target.closest("[data-view-origin-signal]") !== null)
			{
				const reference = this.store.GetDraft()?.originSignal;

				if (reference !== null && reference !== undefined)
				{
					const opening = this.controller.ViewSignalAsync(reference);
					void opening;
				}
			}
			if (connectedView?.dataset.viewConnectedSignal !== undefined)
			{
				const index = Number.parseInt(connectedView.dataset.viewConnectedSignal, 10);
				const reference = this.store.GetDraft()?.relatedSignals[index];

				if (reference !== undefined)
				{
					const opening = this.controller.ViewSignalAsync(reference);
					void opening;
				}
			}
			if (availableView !== null)
			{
				const dreamId = availableView.dataset.viewAvailable;
				const signalId = availableView.dataset.signalId;

				if (dreamId !== undefined && signalId !== undefined)
				{
					const opening = this.controller.ViewSignalAsync({ signalId });
					void opening;
				}
			}
			if (availableAdd !== null && !availableAdd.hasAttribute("disabled"))
			{
				const dreamId = availableAdd.dataset.addAvailable;
				const signalId = availableAdd.dataset.signalId;

				if (dreamId !== undefined && signalId !== undefined)
				{
					const suggestion = this.store.GetView() === "suggestions"
						? this.store.GetSuggestions().find(function FindSuggestion(candidate): boolean
						{
							return candidate.reference.signalId === signalId;
						})
						: undefined;
					const rationale = suggestion?.rationale.trim() ?? "";
					this.controller.AddSignal({
						signalId,
						rationale: rationale.length > 0 ? rationale : null
					});
				}
			}
			if (signalRemoval?.dataset.removeIdeaSignal !== undefined)
			{
				this.controller.RemoveSignal({ signalId: signalRemoval.dataset.removeIdeaSignal });
			}
			if (target.closest("[data-save-idea]") !== null)
			{
				const save = this.controller.SaveAsync();
				void save;
			}
		}
	}
}
