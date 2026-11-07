import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { OrderSignalsByText } from "../../shared/signals/SignalOrder.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LayoutSettings } from "../core/settings/LayoutSettingsStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { CloseIcon, DocumentIcon, EditIcon, OpenIcon, SearchIcon, SignalIcon, TextQuoteIcon, TrashIcon } from "../ui/Icons.js";
import { MarkdownEditor } from "../ui/MarkdownEditor.js";
import { TabPanel } from "../ui/TabPanel.js";
import { SignalRemovalConfirmation } from "./SignalRemovalConfirmation.js";

// Represents the common Signal shape displayed by document editors.
export type SignalViewRecord = SignalRecord;
export type SignalPassageKind = "source" | "external";

// Owns Dream Signal navigation and description presentation.
export abstract class SignalViewPanel extends TabPanel
{
	// Contains Signal navigation rows.
	private readonly list: HTMLElement = document.createElement("div");
	// Filters Signals already connected to the Dream.
	private readonly search: HTMLElement = document.createElement("label");
	// Contains the bounded Signal navigation and editor panes.
	private readonly body: HTMLElement = document.createElement("div");
	// Resizes the Signal navigation pane without changing the detail pane height.
	private readonly divider: HTMLElement = document.createElement("div");
	// Contains the selected Signal description.
	private readonly detail: HTMLElement = document.createElement("div");
	// Context menu for Signal row rename and deletion actions.
	private readonly contextMenu: HTMLElement = document.createElement("div");
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
	// Handles list-title rename keyboard commands.
	private readonly keyDownHandler = this.HandleKeyDown.bind(this);
	// Opens Signal actions at the pointer location.
	private readonly contextMenuHandler = this.HandleContextMenu.bind(this);
	// Dismisses Signal actions when interaction moves elsewhere.
	private readonly dismissContextMenuHandler = this.HandleContextMenuDismiss.bind(this);
	// Persists title edits when the reader commits the field.
	private readonly changeHandler = this.HandleChange.bind(this);
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
	// Identifies the selected exact passage within one Signal.
	private selectedPassage: { signalId: string; selectionIndex: number } | null = null;
	// Contains the latest connected Signals in display order.
	private records: readonly SignalViewRecord[] = [];
	// Contains the source text used to reconstruct exact passage labels.
	private textDocument: TextDocument | null = null;
	// Contains an active Signal navigation resize gesture.
	private resizeDrag: { pointerId: number; x: number; width: number } | null = null;
	// Signal currently targeted by the row context menu.
	private contextSignalId: string | null = null;
	// Confirms removal of the selected Signal from its Dream.
	private readonly removalConfirmation = new SignalRemovalConfirmation();

	// Creates one reusable Signal list/detail panel.
	protected constructor(errors: ErrorManager)
	{
		super("signals", "Signals");
		this.errors = errors;
		this.Root.classList.add("signal-view-panel");
		this.search.className = "signal-view-search dream-search";
		this.search.innerHTML = `<span>Signal index</span>${SearchIcon}<input data-signal-view-search type="search" aria-label="Search connected Signals" placeholder="Filter Signals…">`;
		this.body.className = "signal-view-body";
		const navigationWidth = LayoutSettings.GetDimension("signalNavigationWidth", 0);
		if (navigationWidth > 0) this.body.style.setProperty("--signal-navigation-width", `${navigationWidth}px`);
		this.list.className = "signal-list";
		this.list.setAttribute("aria-label", "Signals");
		this.list.append(this.search);
		this.divider.className = "signal-view-divider column-resize-handle";
		this.divider.setAttribute("role", "separator");
		this.divider.setAttribute("aria-label", "Resize Signal list");
		this.divider.setAttribute("aria-orientation", "vertical");
		this.divider.tabIndex = 0;
		this.detail.className = "signal-detail";
		this.contextMenu.className = "signal-context-menu";
		this.contextMenu.hidden = true;
		this.contextMenu.innerHTML = `<button data-signal-menu-action="rename" type="button">${EditIcon}<span>Rename</span></button><button class="danger" data-signal-menu-action="delete" type="button">${TrashIcon}<span>Delete</span></button>`;
		this.empty.className = "signal-view-empty-state";
		this.empty.innerHTML = `<span class="signal-view-empty-icon" aria-hidden="true">${DocumentIcon}</span><strong>No Signals.</strong><span>Add signals to capture key readings, words, or phrases.</span>`;
		this.detail.append(this.empty);
		this.body.append(this.list, this.divider, this.detail);
		this.Root.append(this.body, this.contextMenu);
		this.Root.addEventListener("click", this.clickHandler);
		this.Root.addEventListener("input", this.inputHandler);
		this.Root.addEventListener("change", this.changeHandler);
		this.Root.addEventListener("keydown", this.keyDownHandler);
		this.Root.addEventListener("contextmenu", this.contextMenuHandler);
		this.Root.addEventListener("dragstart", this.dragStartHandler);
		document.addEventListener("pointerdown", this.dismissContextMenuHandler);
		this.divider.addEventListener("pointerdown", this.resizeDownHandler);
		this.divider.addEventListener("pointermove", this.resizeMoveHandler);
		this.divider.addEventListener("pointerup", this.resizeUpHandler);
		this.divider.addEventListener("pointercancel", this.resizeUpHandler);
		this.divider.addEventListener("lostpointercapture", this.resizeUpHandler);
		this.divider.addEventListener("keydown", this.resizeKeyHandler);
	}

	// Reports application failures from Signal description editors.
	private readonly errors: ErrorManager;

	// Returns the owner-remembered Signal selection.
	protected abstract GetRememberedSignal(): string | null;

	// Records a changed Signal selection with the Dream.
	protected abstract RememberSignal(signalId: string | null): void;

	// Navigates the reader to one Signal.
	protected abstract ViewSignalAsync(signalId: string): Promise<void>;

	// Navigates the reader to one exact passage inside a Signal.
	protected abstract ViewSignalSelection(selection: TextSelection): void;

	// Classifies one passage relative to the Dream source.
	protected GetPassageKind(_selection: TextSelection): SignalPassageKind
	{
		return "external";
	}

	// Deletes one Signal from its owning Dream.
	protected abstract DeleteSignalAsync(signalId: string): Promise<boolean>;

	// Persists one Dream-owned Signal description.
	protected abstract UpdateSignalDescription(signalId: string, description: string): void;

	// Persists one reader-authored Signal title.
	protected abstract UpdateSignalTitle(signalId: string, title: string): void;

	// Removes one passage while retaining the Signal and its remaining passages.
	protected abstract RemoveSignalSelection(signalId: string, selectionIndex: number): void;

	// Reconciles Signal rows while preserving selection and editor state.
	protected UpdateSignals(signals: readonly SignalViewRecord[], document: TextDocument | null = null): void
	{
		const ordered = OrderSignalsByText(document, signals);
		this.textDocument = document;
		this.records = ordered;
		const ids = new Set<string>();

		for (const signal of ordered) ids.add(signal.id);
		for (const [id, row] of this.rows)
		{
			if (!ids.has(id))
			{
				if (this.selectedPassage?.signalId === id) this.selectedPassage = null;
				this.editors.get(id)?.Dispose();
				this.editors.delete(id);
				row.remove();
				this.rows.delete(id);
				this.navigation.get(id)?.remove();
				this.navigation.delete(id);
			}
		}

		let previous: HTMLElement | null = this.search;

		for (const signal of ordered)
		{
			let row = this.rows.get(signal.id);

			if (row === undefined)
			{
				row = this.CreateRow(signal);
				this.rows.set(signal.id, row);
			}
			else
			{
				this.RefreshSignal(signal);
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
			const title = this.GetSignalTitle(signal);

			if (heading !== null && heading !== undefined) heading.textContent = title;
			const button = this.navigation.get(signal.id)?.querySelector<HTMLElement>("[data-signal-toggle]");
			if (button !== null && button !== undefined) button.title = title;
			const titleInput = this.navigation.get(signal.id)?.querySelector<HTMLInputElement>("[data-signal-title]");
			if (titleInput !== null && titleInput !== undefined && document.activeElement !== titleInput) titleInput.value = title;
			this.RenderPassages(signal, row);
			this.editors.get(signal.id)?.SetMarkdown(signal.description);
		}
	}

	// Selects one explicitly requested Signal without scrolling or moving focus.
	public async ShowSignalAsync(signalId: string): Promise<void>
	{
		const row = this.rows.get(signalId);
		const header = this.navigation.get(signalId);

		if (row !== undefined && header !== undefined)
		{
			this.SelectSignal(signalId);
			await Promise.resolve();
		}
	}

	// Releases Signal editors and retained browser listeners.
	public override Dispose(): void
	{
		this.Root.removeEventListener("click", this.clickHandler);
		this.Root.removeEventListener("input", this.inputHandler);
		this.Root.removeEventListener("change", this.changeHandler);
		this.Root.removeEventListener("keydown", this.keyDownHandler);
		this.Root.removeEventListener("contextmenu", this.contextMenuHandler);
		this.Root.removeEventListener("dragstart", this.dragStartHandler);
		document.removeEventListener("pointerdown", this.dismissContextMenuHandler);
		this.divider.removeEventListener("pointerdown", this.resizeDownHandler);
		this.divider.removeEventListener("pointermove", this.resizeMoveHandler);
		this.divider.removeEventListener("pointerup", this.resizeUpHandler);
		this.divider.removeEventListener("pointercancel", this.resizeUpHandler);
		this.divider.removeEventListener("lostpointercapture", this.resizeUpHandler);
		this.divider.removeEventListener("keydown", this.resizeKeyHandler);
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
		const title = this.GetSignalTitle(signal);
		header.innerHTML = `<button class="signal-row button-control" data-signal-toggle="${EscapeHtml(signal.id)}" data-signal-drag="${EscapeHtml(signal.id)}" draggable="true" type="button" aria-expanded="false" title="${EscapeHtml(title)}"><span class="signal-row-icon" aria-hidden="true">${SignalIcon}</span><strong class="signal-heading">${EscapeHtml(title)}</strong></button>`;
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

		if (existing === undefined && signal !== undefined && row !== undefined && body !== null && body !== undefined)
		{
			const identity = document.createElement("section");
			identity.className = "signal-identity";
			identity.innerHTML = `<section class="signal-passages" aria-label="Signal passages"><strong>Passages</strong><div data-signal-passages="${EscapeHtml(signal.id)}"></div></section>`;
			body.append(identity);
			this.RenderPassages(signal, row);
			const change = this.HandleDescriptionChange.bind(this, signal.id);
			const editor = new MarkdownEditor(signal.description, "Signal description", change, this.errors);
			editor.Root.classList.add("signal-markdown-editor");
			editor.Root.dataset.signalDescription = signal.id;
			this.editors.set(signal.id, editor);

			const observation = document.createElement("section");
			observation.className = "signal-observation";
			observation.append(editor.Root);
			body.append(observation);
		}
	}

	// Selects one Signal and updates navigation accessibility state.
	private SelectSignal(signalId: string | null): void
	{
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
			? "Add signals to capture key readings, words, or phrases."
			: "Try a different search.";

		const remembered = this.GetRememberedSignal();
		const selected = remembered !== null && matchingIds.has(remembered)
			? remembered
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

	// Persists a committed title while restoring the current canonical value for an empty field.
	private HandleChange(event: Event): void
	{
		const target = event.target as HTMLInputElement | null;
		const signalId = target?.dataset.signalTitle;

		if (signalId !== undefined && target !== null)
		{
			const signal = this.records.find((candidate) => candidate.id === signalId);
			const title = target.value.trim();

			if (title.length > 0)
			{
				target.value = title;
				this.UpdateSignalTitle(signalId, title);
				const heading = this.navigation.get(signalId)?.querySelector<HTMLElement>(".signal-heading");
				if (heading !== null && heading !== undefined) heading.textContent = title;
			}
			else if (signal !== undefined)
			{
				target.value = this.GetSignalTitle(signal);
			}
			this.FinishRename(signalId);
		}
	}

	// Commits or cancels inline Signal-list title editing.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const input = event.target as HTMLInputElement | null;
		const signalId = input?.dataset.signalTitle;

		if (signalId !== undefined && input !== null)
		{
			if (event.key === "Enter")
			{
				event.preventDefault();
				input.blur();
			}
			else if (event.key === "Escape")
			{
				event.preventDefault();
				this.FinishRename(signalId);
			}
		}
	}

	// Opens row actions for the Signal under the pointer.
	private HandleContextMenu(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const header = target?.closest<HTMLElement>(".signal-header") ?? null;
		const toggle = header?.querySelector<HTMLButtonElement>("[data-signal-toggle]") ?? null;
		const signalId = toggle?.dataset.signalToggle;

		if (signalId !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			this.SelectSignal(signalId);
			this.contextSignalId = signalId;
			this.contextMenu.hidden = false;
			const bounds = this.contextMenu.getBoundingClientRect();
			const left = Math.min(event.clientX, Math.max(0, window.innerWidth - bounds.width - 8));
			const top = Math.min(event.clientY, Math.max(0, window.innerHeight - bounds.height - 8));
			this.contextMenu.style.left = `${left}px`;
			this.contextMenu.style.top = `${top}px`;
			this.contextMenu.querySelector<HTMLButtonElement>("button")?.focus();
		}
	}

	// Closes row actions when interaction moves outside their surface.
	private HandleContextMenuDismiss(event: PointerEvent): void
	{
		const target = event.target;
		if (target instanceof Node && !this.contextMenu.contains(target))
		{
			this.CloseContextMenu();
		}
	}

	// Routes Signal selection, explicit navigation, and removal commands.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const menuAction = target?.closest<HTMLButtonElement>("[data-signal-menu-action]")?.dataset.signalMenuAction;
		const passage = target?.closest<HTMLElement>("[data-signal-passage-index]") ?? null;
		const jumpPassageButton = target?.closest<HTMLButtonElement>("[data-jump-signal-passage]") ?? null;
		const removePassageButton = target?.closest<HTMLButtonElement>("[data-remove-signal-passage]") ?? null;
		const handled = menuAction !== undefined
			|| passage !== null
			|| removePassageButton !== null;

		if (menuAction === "rename" && this.contextSignalId !== null)
		{
			const signalId = this.contextSignalId;
			this.CloseContextMenu();
			this.StartRename(signalId);
		}
		else if (menuAction === "delete" && this.contextSignalId !== null)
		{
			const signalId = this.contextSignalId;
			const signal = this.records.find(function FindSignal(candidate): boolean
			{
				return candidate.id === signalId;
			});
			const trigger = this.navigation.get(signalId)?.querySelector<HTMLElement>("[data-signal-toggle]");
			this.CloseContextMenu();

			if (signal !== undefined && trigger !== null && trigger !== undefined)
			{
				const remove = this.DeleteSignalAsync.bind(this, signalId);
				this.removalConfirmation.Open(this.GetSignalTitle(signal), trigger, remove);
			}
		}
		else if (removePassageButton !== null)
		{
			const signalId = removePassageButton.dataset.signalId;
			const selectionIndex = Number.parseInt(removePassageButton.dataset.removeSignalPassage ?? "", 10);
			if (signalId !== undefined && Number.isInteger(selectionIndex)) this.RemoveSignalSelection(signalId, selectionIndex);
		}
		else if (jumpPassageButton !== null && passage !== null)
		{
			const signalId = passage.dataset.signalId;
			const selectionIndex = Number.parseInt(passage.dataset.signalPassageIndex ?? "", 10);
			const signal = this.records.find((candidate) => candidate.id === signalId);
			const selection = signal?.selections[selectionIndex];

			if (signalId !== undefined && selection !== undefined)
			{
				this.SelectPassage(signalId, selectionIndex);
				this.ViewSignalSelection(selection);
			}
		}
		else if (passage !== null && !this.HasSelectedText(passage))
		{
			const signalId = passage.dataset.signalId;
			const selectionIndex = Number.parseInt(passage.dataset.signalPassageIndex ?? "", 10);

			if (signalId !== undefined && Number.isInteger(selectionIndex))
			{
				this.SelectPassage(signalId, selectionIndex);
			}
		}
		const toggleButton = target?.closest<HTMLButtonElement>("[data-signal-toggle]");

		if (!handled && toggleButton !== null && toggleButton !== undefined)
		{
			const signalId = toggleButton.dataset.signalToggle;

			if (signalId !== undefined)
			{
				void this.ShowSignalAsync(signalId);
			}
		}
	}

	// Replaces one list title with an inline input until commit or cancellation.
	private StartRename(signalId: string): void
	{
		const signal = this.records.find(function FindSignal(candidate): boolean
		{
			return candidate.id === signalId;
		});
		const header = this.navigation.get(signalId);
		const toggle = header?.querySelector<HTMLButtonElement>("[data-signal-toggle]");

		if (signal !== undefined && header !== undefined && toggle !== null && toggle !== undefined)
		{
			const input = document.createElement("input");
			input.className = "signal-row-title-input";
			input.dataset.signalTitle = signalId;
			input.setAttribute("aria-label", "Signal title");
			input.value = this.GetSignalTitle(signal);
			toggle.hidden = true;
			header.append(input);
			input.focus();
			input.select();
		}
	}

	// Restores the row button after inline title editing.
	private FinishRename(signalId: string): void
	{
		const header = this.navigation.get(signalId);
		const toggle = header?.querySelector<HTMLButtonElement>("[data-signal-toggle]");
		header?.querySelector<HTMLInputElement>("[data-signal-title]")?.remove();
		if (toggle !== null && toggle !== undefined) toggle.hidden = false;
		toggle?.focus({ preventScroll: true });
	}

	// Hides row actions and clears their transient Signal identity.
	private CloseContextMenu(): void
	{
		this.contextMenu.hidden = true;
		this.contextSignalId = null;
	}

	// Returns the reader-facing Signal name, using source text until the reader supplies a title.
	private GetSignalTitle(signal: SignalViewRecord): string
	{
		const title = signal.title?.trim() ?? "";
		const value = title.length > 0 ? title : signal.text;

		return value;
	}

	// Rebuilds exact passage rows from the current canonical selections.
	private RenderPassages(signal: SignalViewRecord, row: HTMLElement): void
	{
		const host = row.querySelector<HTMLElement>("[data-signal-passages]");

		if (host !== null)
		{
			host.replaceChildren();
			if (this.selectedPassage?.signalId === signal.id
				&& this.selectedPassage.selectionIndex >= signal.selections.length)
			{
				this.selectedPassage = null;
			}

			for (const [index, selection] of signal.selections.entries())
			{
				const passage = document.createElement("div");
				const kind = this.GetPassageKind(selection);
				const selected = this.selectedPassage?.signalId === signal.id
					&& this.selectedPassage.selectionIndex === index;
				const removable = signal.selections.length > 1;
				passage.className = `signal-passage signal-passage-${kind}${removable ? " signal-passage-removable" : ""}${selected ? " selected" : ""}`;
				passage.dataset.signalId = signal.id;
				passage.dataset.signalPassageIndex = `${index}`;
				passage.dataset.signalPassageKind = kind;
				passage.setAttribute("aria-current", String(selected));
				const text = this.textDocument?.id === selection.dialogue
					? this.textDocument.ReconstructText(selection)
					: index === 0
						? signal.text
						: `Passage ${index + 1}`;
				const passageLabel = kind === "source" ? "Dream source passage" : "External passage";
				const icon = kind === "source" ? TextQuoteIcon : OpenIcon;
				const removePassage = removable
					? `<button class="signal-passage-remove button-control" data-remove-signal-passage="${index}" data-signal-id="${EscapeHtml(signal.id)}" type="button" title="Remove passage" aria-label="Remove passage">${CloseIcon}</button>`
					: "";
				passage.innerHTML = `<span class="signal-passage-text" title="${passageLabel}">${EscapeHtml(text)}</span><button class="signal-passage-navigation button-control" data-jump-signal-passage type="button" title="Jump to ${passageLabel.toLocaleLowerCase()} in text" aria-label="Jump to ${passageLabel.toLocaleLowerCase()} in text">${icon}</button>${removePassage}`;
				host.append(passage);
			}
		}
	}

	// Selects one passage row without changing its Signal identity.
	private SelectPassage(signalId: string, selectionIndex: number): void
	{
		this.selectedPassage = { signalId, selectionIndex };
		const passages = this.Root.querySelectorAll<HTMLElement>("[data-signal-passage-index]");

		for (const passage of Array.from(passages))
		{
			const selected = passage.dataset.signalId === signalId
				&& Number.parseInt(passage.dataset.signalPassageIndex ?? "", 10) === selectionIndex;
			passage.classList.toggle("selected", selected);
			passage.setAttribute("aria-current", String(selected));
		}
	}

	// Preserves native browser selection instead of treating a completed drag as navigation.
	private HasSelectedText(passage: HTMLElement): boolean
	{
		const selection = window.getSelection();
		const hasSelection = selection !== null
			&& !selection.isCollapsed
			&& selection.toString().length > 0;
		const anchorInside = hasSelection && selection?.anchorNode !== null && passage.contains(selection.anchorNode);
		const focusInside = hasSelection && selection?.focusNode !== null && passage.contains(selection.focusNode);

		return anchorInside || focusInside;
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
