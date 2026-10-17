import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LayoutSettings } from "../core/settings/LayoutSettingsStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { AddIcon, DocumentIcon, SearchIcon, SignalIcon, TrashIcon } from "../ui/Icons.js";
import { MarkdownEditor } from "../ui/MarkdownEditor.js";
import { TabPanel } from "../ui/TabPanel.js";
import { SignalRemovalConfirmation, type SignalAssociationOwner } from "./SignalRemovalConfirmation.js";

// Represents the common Signal shape displayed by document editors.
export type SignalViewRecord = SignalRecord;

// Owns the shared Signal navigation and description presentation.
export abstract class SignalViewPanel extends TabPanel
{
	// Contains Signal navigation rows.
	private readonly list: HTMLElement = document.createElement("div");
	// Contains the shared Signal title and connected-Signal search.
	private readonly header: HTMLElement = document.createElement("header");
	// Filters Signals already connected to the owning document.
	private readonly search: HTMLElement = document.createElement("label");
	// Contains the bounded Signal navigation and editor panes.
	private readonly body: HTMLElement = document.createElement("div");
	// Resizes the Signal navigation pane without changing the detail pane height.
	private readonly divider: HTMLElement = document.createElement("div");
	// Contains the selected Signal description.
	private readonly detail: HTMLElement = document.createElement("div");
	// Contains navigation rows by Signal identity.
	private readonly navigation = new Map<string, HTMLElement>();
	// Contains detail rows by Signal identity.
	private readonly rows = new Map<string, HTMLElement>();
	// Contains persistent description editors by Signal identity.
	private readonly editors = new Map<string, MarkdownEditor>();
	// Displays the empty collection state.
	private readonly empty: HTMLElement = document.createElement("p");
	// Handles delegated clicks for the panel lifetime.
	private readonly clickHandler = this.HandleClick.bind(this);
	// Handles connected-Signal filtering for the panel lifetime.
	private readonly inputHandler = this.HandleInput.bind(this);
	// Publishes one Signal identity through native drag data.
	private readonly dragStartHandler = this.HandleDragStart.bind(this);
	// Begins resizing the Signal navigation pane.
	private readonly resizeDownHandler = this.HandleResizePointerDown.bind(this);
	// Applies pointer movement while the Signal divider is active.
	private readonly resizeMoveHandler = this.HandleResizePointerMove.bind(this);
	// Completes one Signal divider drag.
	private readonly resizeUpHandler = this.HandleResizePointerUp.bind(this);
	// Supports keyboard resizing from the Signal divider.
	private readonly resizeKeyHandler = this.HandleResizeKeyDown.bind(this);
	// Identifies the selected Signal.
	private selectedSignalId: string | null = null;
	// Contains the latest connected Signals in display order.
	private records: readonly SignalViewRecord[] = [];
	// Contains an active Signal navigation resize gesture.
	private resizeDrag: { pointerId: number; x: number; width: number } | null = null;
	// Ensures only the latest reveal request may scroll.
	private revealVersion = 0;
	// Contains the optional owner-specific add action.
	private readonly addButton: HTMLButtonElement | null;
	// Confirms removal of the selected Signal from its current document.
	private readonly removalConfirmation = new SignalRemovalConfirmation();

	// Creates one reusable Signal list/detail panel.
	protected constructor(errors: ErrorManager, showAddSignal = true, showHeader = true)
	{
		super("signals", "Signals");
		this.errors = errors;
		this.Root.classList.add("signal-view-panel");
		this.header.className = "signal-view-header";
		this.search.className = "signal-view-search dream-search";
		this.search.innerHTML = `${SearchIcon}<input data-signal-view-search type="search" aria-label="Search connected Signals" placeholder="Search">`;
		this.header.innerHTML = "<h3>Signals</h3>";
		this.body.className = "signal-view-body";
		const navigationWidth = LayoutSettings.GetDimension("signalNavigationWidth", 0);
		if (navigationWidth > 0) this.body.style.setProperty("--signal-navigation-width", `${navigationWidth}px`);
		this.list.className = "signal-list";
		this.list.setAttribute("aria-label", "Signals");
		this.list.append(this.search);
		let addButton: HTMLButtonElement | null = null;
		if (showAddSignal)
		{
			addButton = document.createElement("button");
			addButton.type = "button";
			addButton.className = "signal-view-add button-control";
			addButton.dataset.signalViewAdd = "";
			addButton.innerHTML = `${AddIcon}<span>Add new</span>`;
			addButton.title = "Add new Signal";
			addButton.setAttribute("aria-label", "Add new Signal");
			this.header.append(addButton);
		}
		this.addButton = addButton;
		if (!showHeader)
		{
			this.Root.classList.add("signal-view-panel-without-header");
		}
		this.divider.className = "signal-view-divider";
		this.divider.setAttribute("role", "separator");
		this.divider.setAttribute("aria-label", "Resize Signal list");
		this.divider.setAttribute("aria-orientation", "vertical");
		this.divider.tabIndex = 0;
		this.detail.className = "signal-detail";
		this.empty.className = "signal-view-empty-state";
		this.empty.innerHTML = `<span class="signal-view-empty-icon" aria-hidden="true">${DocumentIcon}</span><strong>No Signals.</strong><span>Add signals to capture key readings, words, or ideas.</span>`;
		this.detail.append(this.empty);
		this.body.append(this.list, this.divider, this.detail);
		if (showHeader) this.Root.append(this.header);
		this.Root.append(this.body);
		this.Root.addEventListener("click", this.clickHandler);
		this.Root.addEventListener("input", this.inputHandler);
		this.Root.addEventListener("dragstart", this.dragStartHandler);
		this.divider.addEventListener("pointerdown", this.resizeDownHandler);
		this.divider.addEventListener("pointermove", this.resizeMoveHandler);
		this.divider.addEventListener("pointerup", this.resizeUpHandler);
		this.divider.addEventListener("pointercancel", this.resizeUpHandler);
		this.divider.addEventListener("lostpointercapture", this.resizeUpHandler);
		this.divider.addEventListener("keydown", this.resizeKeyHandler);
	}

	// Reports application failures from Signal description editors.
	private readonly errors: ErrorManager;

	// Moves the optional add action into the owner-provided header.
	public AttachAddSignalAction(host: HTMLElement): void
	{
		if (this.addButton !== null)
		{
			host.append(this.addButton);
			this.addButton.addEventListener("click", this.clickHandler);
		}
	}

	// Returns the owner-remembered Signal selection.
	protected abstract GetRememberedSignal(): string | null;

	// Records a changed Signal selection with the owning document.
	protected abstract RememberSignal(signalId: string | null): void;

	// Navigates the reader to one Signal.
	protected abstract ViewSignalAsync(signalId: string): Promise<void>;

	// Returns the document type that owns the displayed Signal association.
	protected abstract GetAssociationOwner(): SignalAssociationOwner;

	// Removes one Signal association from the owning document.
	protected abstract RemoveSignalAssociation(signalId: string): void;

	// Appends owner-specific commands to one Signal action row.
	protected AppendSignalActions(_actions: HTMLElement, _signalId: string): void
	{
	}

	// Handles an owner-specific Signal command.
	protected HandleSignalAction(_target: HTMLElement | null): boolean
	{
		const handled = false;

		return handled;
	}

	// Persists one shared Signal description.
	protected abstract UpdateSignalDescription(signalId: string, description: string): void;

	// Starts an optional owner-specific workflow for adding a Signal.
	protected AddSignal(): void
	{
	}

	// Reconciles Signal rows while preserving selection and editor state.
	protected UpdateSignals(signals: readonly SignalViewRecord[]): void
	{
		this.records = Array.from(signals);
		const ids = new Set<string>();

		for (const signal of signals) ids.add(signal.id);
		for (const [id, row] of this.rows)
		{
			if (!ids.has(id))
			{
				this.editors.get(id)?.Dispose();
				this.editors.delete(id);
				row.remove();
				this.rows.delete(id);
				this.navigation.get(id)?.remove();
				this.navigation.delete(id);
			}
		}

		let previous: HTMLElement | null = this.search;

		for (const signal of signals)
		{
			let row = this.rows.get(signal.id);

			if (row === undefined)
			{
				row = this.CreateRow(signal);
				this.rows.set(signal.id, row);
			}
			else
			{
				this.editors.get(signal.id)?.SetMarkdown(signal.description);
			}

			const header = this.navigation.get(signal.id);
			const next: ChildNode | null = previous === null ? this.list.firstChild : previous.nextSibling;

			if (header !== undefined && next !== header) this.list.insertBefore(header, next);
			if (header !== undefined) previous = header;
		}

		this.ApplySearch();
	}

	// Refreshes one visible canonical Signal without rebuilding the document editor.
	public RefreshSignal(signal: SignalViewRecord): void
	{
		const row = this.rows.get(signal.id);

		if (row !== undefined)
		{
			this.records = this.records.map(function ReplaceSignal(candidate): SignalViewRecord
			{
				return candidate.id === signal.id ? signal : candidate;
			});
			const heading = this.navigation.get(signal.id)?.querySelector<HTMLElement>(".signal-heading");

			if (heading !== null && heading !== undefined) heading.textContent = signal.text;
			const button = this.navigation.get(signal.id)?.querySelector<HTMLElement>("[data-signal-toggle]");
			if (button !== null && button !== undefined) button.title = signal.text;
			this.editors.get(signal.id)?.SetMarkdown(signal.description);
		}
	}

	// Selects and optionally reveals one Signal after its editor is ready.
	public async ShowSignalAsync(signalId: string, reveal = true): Promise<void>
	{
		const row = this.rows.get(signalId);
		const header = this.navigation.get(signalId);
		this.revealVersion += 1;
		const version = this.revealVersion;

		if (row !== undefined && header !== undefined)
		{
			this.SelectSignal(signalId);
			const editor = this.editors.get(signalId);

			if (editor !== undefined)
			{
				await editor.Ready;
				const canReveal = version === this.revealVersion
					&& row.isConnected
					&& header.isConnected
					&& !this.Root.hidden
					&& !row.hidden;

				if (canReveal)
				{
					editor.Focus();

					if (reveal)
					{
						header.scrollIntoView({ block: "nearest", behavior: "smooth" });
						row.scrollIntoView({ block: "nearest", behavior: "smooth" });
					}
				}
			}
		}
	}

	// Releases Signal editors and retained browser listeners.
	public override Dispose(): void
	{
		this.revealVersion += 1;
		this.Root.removeEventListener("click", this.clickHandler);
		this.Root.removeEventListener("input", this.inputHandler);
		this.Root.removeEventListener("dragstart", this.dragStartHandler);
		this.divider.removeEventListener("pointerdown", this.resizeDownHandler);
		this.divider.removeEventListener("pointermove", this.resizeMoveHandler);
		this.divider.removeEventListener("pointerup", this.resizeUpHandler);
		this.divider.removeEventListener("pointercancel", this.resizeUpHandler);
		this.divider.removeEventListener("lostpointercapture", this.resizeUpHandler);
		this.divider.removeEventListener("keydown", this.resizeKeyHandler);
		this.addButton?.removeEventListener("click", this.clickHandler);
		this.removalConfirmation.Dispose();

		for (const editor of this.editors.values()) editor.Dispose();

		this.editors.clear();
		this.rows.clear();
		this.navigation.clear();
		super.Dispose();
	}

	// Creates one navigation row and persistent description editor.
	private CreateRow(signal: SignalViewRecord): HTMLElement
	{
		const row = document.createElement("section");
		row.className = "signal-item";
		row.dataset.signalId = signal.id;
		const header = document.createElement("div");
		header.className = "signal-header";
		header.innerHTML = `<button class="signal-row button-control" data-signal-toggle="${EscapeHtml(signal.id)}" data-signal-drag="${EscapeHtml(signal.id)}" draggable="true" type="button" aria-expanded="false" title="${EscapeHtml(signal.text)}"><span class="signal-row-icon" aria-hidden="true">${SignalIcon}</span><strong class="signal-heading">${EscapeHtml(signal.text)}</strong></button>`;
		this.navigation.set(signal.id, header);
		const body = document.createElement("div");
		body.className = "signal-detail-body";
		row.append(body);
		this.detail.append(row);

		return row;
	}

	// Begins one pointer-driven resize of the Signal navigation pane.
	private HandleResizePointerDown(event: PointerEvent): void
	{
		if (event.button === 0)
		{
			event.preventDefault();
			const width = this.list.getBoundingClientRect().width;
			this.resizeDrag = { pointerId: event.pointerId, x: event.clientX, width };
			this.divider.setPointerCapture(event.pointerId);
			this.divider.classList.add("is-active");
			this.body.classList.add("is-resizing");
		}
	}

	// Applies one active Signal navigation resize gesture.
	private HandleResizePointerMove(event: PointerEvent): void
	{
		if (this.resizeDrag !== null && this.resizeDrag.pointerId === event.pointerId)
		{
			const width = this.resizeDrag.width + event.clientX - this.resizeDrag.x;
			this.SetNavigationWidth(width);
		}
	}

	// Completes one pointer-driven Signal navigation resize gesture.
	private HandleResizePointerUp(): void
	{
		if (this.resizeDrag !== null)
		{
			const pointerId = this.resizeDrag.pointerId;
			this.resizeDrag = null;
			if (this.divider.hasPointerCapture(pointerId)) this.divider.releasePointerCapture(pointerId);
			this.divider.classList.remove("is-active");
			this.body.classList.remove("is-resizing");
		}
	}

	// Resizes the Signal navigation pane from an accessible keyboard separator.
	private HandleResizeKeyDown(event: KeyboardEvent): void
	{
		if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")
		{
			event.preventDefault();
			let width = this.list.getBoundingClientRect().width + (event.key === "ArrowRight" ? 24 : -24);
			if (event.key === "Home") width = 150;
			if (event.key === "End") width = Number.MAX_SAFE_INTEGER;
			this.SetNavigationWidth(width);
		}
	}

	// Clamps and applies the Signal navigation width while preserving usable detail space.
	private SetNavigationWidth(width: number): void
	{
		const totalWidth = this.body.getBoundingClientRect().width;
		const minimumNavigationWidth = 150;
		const minimumDetailWidth = 240;
		const dividerWidth = this.divider.getBoundingClientRect().width;
		const maximumWidth = Math.max(minimumNavigationWidth, totalWidth - minimumDetailWidth - dividerWidth);
		const navigationWidth = Math.min(maximumWidth, Math.max(minimumNavigationWidth, width));
		this.body.style.setProperty("--signal-navigation-width", `${navigationWidth}px`);
		LayoutSettings.SetDimension("signalNavigationWidth", navigationWidth);
		this.divider.setAttribute("aria-valuemin", `${minimumNavigationWidth}`);
		this.divider.setAttribute("aria-valuemax", `${maximumWidth}`);
		this.divider.setAttribute("aria-valuenow", `${navigationWidth}`);
	}

	// Creates the selected Signal editor only when it can be initialized visibly.
	private EnsureEditor(signalId: string): void
	{
		const existing = this.editors.get(signalId);
		const signal = this.records.find(function FindSignal(candidate): boolean
		{
			return candidate.id === signalId;
		});
		const row = this.rows.get(signalId);
		const body = row?.querySelector<HTMLElement>(".signal-detail-body");

		if (existing === undefined && signal !== undefined && body !== null && body !== undefined)
		{
			const change = this.HandleDescriptionChange.bind(this, signal.id);
			const editor = new MarkdownEditor(signal.description, "Signal description", change, this.errors);
			editor.Root.classList.add("signal-markdown-editor");
			editor.Root.dataset.signalDescription = signal.id;
			this.editors.set(signal.id, editor);
			const markdownToolbar = editor.Root.querySelector<HTMLElement>(".markdown-toolbar");

			if (markdownToolbar !== null)
			{
				const actions = document.createElement("div");
				actions.className = "signal-toolbar-actions";
				this.AppendSignalActions(actions, signal.id);
				const removeLabel = `Remove from ${this.GetAssociationOwner()}`;
				const removeButton = document.createElement("button");
				removeButton.type = "button";
				removeButton.className = "signal-remove-association button-control";
				removeButton.dataset.removeSignalAssociation = signal.id;
				removeButton.title = removeLabel;
				removeButton.setAttribute("aria-label", removeLabel);
				removeButton.innerHTML = TrashIcon;
				actions.append(removeButton);
				markdownToolbar.append(actions);
			}

			const observation = document.createElement("section");
			observation.className = "signal-observation";
			observation.append(editor.Root);
			body.append(observation);
		}
	}

	// Selects one Signal and updates navigation accessibility state.
	private SelectSignal(signalId: string | null): void
	{
		this.selectedSignalId = signalId;
		this.RememberSignal(signalId);

		for (const [id, row] of this.rows)
		{
			const selected = id === signalId;
			row.hidden = !selected;
			const header = this.navigation.get(id);
			header?.classList.toggle("selected", selected);
			const button = header?.querySelector("[data-signal-toggle]");
			button?.setAttribute("aria-current", String(selected));
			button?.setAttribute("aria-expanded", String(selected));
		}

		if (signalId !== null) this.EnsureEditor(signalId);
	}

	// Filters connected Signals and keeps selection within the visible result set.
	private ApplySearch(): void
	{
		const input = this.search.querySelector<HTMLInputElement>("[data-signal-view-search]");
		const query = input?.value.trim().toLocaleLowerCase() ?? "";
		const matchingIds = new Set<string>();

		for (const signal of this.records)
		{
			const searchable = `${signal.text} ${signal.description}`.toLocaleLowerCase();
			const matches = query.length === 0 || searchable.includes(query);
			this.navigation.get(signal.id)?.toggleAttribute("hidden", !matches);
			if (matches) matchingIds.add(signal.id);
		}

		const hasMatches = matchingIds.size > 0;
		this.Root.classList.toggle("empty", !hasMatches);
		this.empty.hidden = hasMatches;
		const title = this.empty.querySelector("strong");
		const explanation = this.empty.querySelector("span:last-child");

		if (title !== null) title.textContent = this.records.length === 0 ? "No Signals." : "No matching Signals.";
		if (explanation !== null) explanation.textContent = this.records.length === 0
			? "Add signals to capture key readings, words, or ideas."
			: "Try a different search.";

		const remembered = this.GetRememberedSignal();
		const selected = remembered !== null && matchingIds.has(remembered)
			? remembered
			: this.selectedSignalId !== null && matchingIds.has(this.selectedSignalId)
				? this.selectedSignalId
				: this.records.find(function FindMatching(signal): boolean
				{
					return matchingIds.has(signal.id);
				})?.id ?? null;
		this.SelectSignal(selected);
	}

	// Applies connected-Signal search without rebuilding persistent editors.
	private HandleInput(event: Event): void
	{
		const target = event.target as HTMLInputElement | null;

		if (target?.matches("[data-signal-view-search]") === true)
		{
			this.ApplySearch();
		}
	}

	// Routes Signal selection and removal commands.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const removeButton = target?.closest<HTMLButtonElement>("[data-remove-signal-association]") ?? null;
		let handled = removeButton !== null;

		if (removeButton !== null)
		{
			const signalId = removeButton.dataset.removeSignalAssociation;
			const signal = this.records.find(function FindSignal(candidate): boolean
			{
				return candidate.id === signalId;
			});

			if (signalId !== undefined && signal !== undefined)
			{
				this.removalConfirmation.Open(
					signal.text,
					this.GetAssociationOwner(),
					removeButton,
					this.RemoveSignalAssociation.bind(this, signalId));
			}
		}
		else
		{
			handled = this.HandleSignalAction(target);
		}
		const addSignal = target?.closest("[data-signal-view-add]") !== null;

		if (!handled && addSignal) this.AddSignal();
		const toggleButton = target?.closest<HTMLButtonElement>("[data-signal-toggle]");

		if (!handled && !addSignal && toggleButton !== null && toggleButton !== undefined)
		{
			const signalId = toggleButton.dataset.signalToggle;

			if (signalId !== undefined)
			{
				void this.ShowSignalAsync(signalId, false);
				void this.ViewSignalAsync(signalId);
			}
		}
	}

	// Routes one description edit to the owning workflow.
	private HandleDescriptionChange(signalId: string, markdown: string): void
	{
		this.UpdateSignalDescription(signalId, markdown);
	}

	// Writes one Signal identity to the native drag payload.
	private HandleDragStart(event: DragEvent): void
	{
		const target = event.target as HTMLElement | null;
		const signalId = target?.closest<HTMLElement>("[data-signal-drag]")?.dataset.signalDrag;

		if (signalId !== undefined && event.dataTransfer !== null)
		{
			event.dataTransfer.effectAllowed = "copy";
			event.dataTransfer.setData("application/x-chora-signal", signalId);
			event.dataTransfer.setData("text/plain", signalId);
		}
	}
}
