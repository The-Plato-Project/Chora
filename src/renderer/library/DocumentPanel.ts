import type { TextDocument, TextSegment, SourceNotice } from "../../shared/library/LibraryTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import { LibraryController } from "../library/LibraryController.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { CaptureSelection, ClearBrowserSelection } from "./Selection.js";
import { EscapeHtml } from "../ui/Html.js";
import { CloseIcon, PreviousIcon, NextIcon, SearchIcon } from "../ui/Icons.js";
import { RenderSemanticText } from "./SemanticTextMarkup.js";
import {
	CreateVisionReferencePayload,
	SerializeVisionReferenceClipboardHtml,
	SerializeVisionReferenceDrag,
	VisionReferenceDragMime
} from "../../shared/visions/VisionReferenceTypes.js";

// Renders the active text and its reading toolbar, and translates browser events into controller calls.
export class DocumentPanel
{
	// Event-bus subscriptions released when the panel is disposed.
	private readonly subscriptions: Unsubscribe[] = [];
	// Pending reading-focus capture timer, or null when nothing is scheduled.
	private focusTimer: ReturnType<typeof setTimeout> | null = null;
	// Highlighted find matches and the currently focused match index.
	private findHits: HTMLElement[] = [];
	private findIndex = 0;
	// Lowercased query currently highlighted, used to detect repeat searches.
	private activeFindQuery = "";
	// Exact canonical ranges belonging to the lemma active in Word Lookup.
	private wordHighlights: readonly TextSelection[] = [];
	private readonly historyBack: string[] = [];
	private readonly historyForward: string[] = [];
	private focusedSegmentKey: string | null = null;
	// Viewport that owns reader scrolling in the composed workspace.
	private readonly scrollRoot: HTMLElement;
	private readonly scrollHandler = this.ScheduleReadingFocus.bind(this);
	private readonly copyHandler = this.HandleCopy.bind(this);

	// Wires up DOM and application-event listeners.
	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly library: LibraryStore,
		private readonly controller: LibraryController)
	{
		this.scrollRoot = this.root;
		this.root.addEventListener("change", this.HandleChange.bind(this));
		this.root.addEventListener("input", this.HandleInput.bind(this));
		this.root.addEventListener("keydown", this.HandleKeyDown.bind(this));
		this.root.addEventListener("click", this.HandleClick.bind(this));
		this.root.addEventListener("dragstart", this.HandleSelectionDragStart.bind(this));
		this.root.addEventListener("copy", this.copyHandler);
		this.root.addEventListener("mouseup", this.CaptureCurrentSelection.bind(this));
		this.root.addEventListener("keyup", this.CaptureCurrentSelection.bind(this));
		this.scrollRoot.addEventListener("scroll", this.scrollHandler);
		this.root.addEventListener("contextmenu", this.HandleContextMenuAsync.bind(this));
		this.subscriptions.push(this.events.Subscribe("library.text-opened", this.HandleTextOpened.bind(this)));
		this.subscriptions.push(this.events.Subscribe("library.jump-requested", this.HandleJumpRequested.bind(this)));
		this.subscriptions.push(this.events.Subscribe("library.focus-changed", this.HandleFocusChanged.bind(this)));
		this.subscriptions.push(this.events.Subscribe("library.position-restored", this.HandlePositionRestored.bind(this)));
		this.subscriptions.push(this.events.Subscribe("word.highlights-changed", this.HandleWordHighlightsChanged.bind(this)));
		this.RenderWelcome();
	}

	// Releases event-bus subscriptions and any pending reading-focus timer.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		if (this.focusTimer !== null) clearTimeout(this.focusTimer);
		this.scrollRoot.removeEventListener("scroll", this.scrollHandler);
		this.root.removeEventListener("copy", this.copyHandler);
	}

	// Routes a text-opened application event to a fresh render.
	private HandleTextOpened(): void
	{
		this.wordHighlights = [];
		const snapshot = this.library.GetSnapshot();
		if (snapshot.text !== null) this.Update(snapshot.text, snapshot.sourceNotice);
	}

	// Replaces persistent lemma decorations without scrolling or creating a browser selection.
	private HandleWordHighlightsChanged(event: ChoraEvents["word.highlights-changed"]): void
	{
		this.wordHighlights = structuredClone(event.selections);
		this.RenderWordHighlights();
		ClearBrowserSelection();
	}

	// Renders the quiet startup state before a text is opened.
	private RenderWelcome(): void
	{
		this.root.innerHTML = `<section class="workspace-welcome" aria-labelledby="workspace-welcome-heading"><h1 id="workspace-welcome-heading">Chora</h1><div class="workspace-welcome-actions"><button class="button-control" data-welcome-open-library type="button">Open Library</button></div></section>`;
	}

	// Routes a jump-requested application event to the scroll workflow.
	private HandleJumpRequested(event: ChoraEvents["library.jump-requested"]): void
	{
		const selections = event.selections ?? (event.selection === undefined ? [] : [event.selection]);
		this.JumpToSelections(selections, event.target ?? "source");
	}

	// Restores position independently of deliberate source navigation and highlighting.
	private HandlePositionRestored(event: ChoraEvents["library.position-restored"]): void
	{
		const key = CSS.escape(event.segmentKey);
		const segment = this.root.querySelector<HTMLElement>(`[data-segment-key="${key}"]`);
		if (segment !== null) this.ScrollToSegment(segment, false);
	}

	// Renders the full reading pane for a newly opened text.
	private Update(document: TextDocument, sourceNotice: SourceNotice | null): void
	{
		this.findHits = [];
		this.findIndex = 0;
		this.activeFindQuery = "";
		this.historyBack.length = 0;
		this.historyForward.length = 0;
		this.focusedSegmentKey = document.segments[0]?.key ?? null;
		const toolbar = this.RenderReaderToolbar(document);
		const segments = this.RenderSegments(document);
		this.root.innerHTML = `<section id="readingPane">${toolbar}<div class="text-body">${segments}</div>${this.RenderSourceAttribution(document, sourceNotice)}</section>`;
		this.UpdateFindCount();
		this.UpdateHistoryControls();
		this.ScheduleReadingFocus();
	}

	// Renders every document segment, inserting book headings and Stephanus locators where they begin.
	private RenderSegments(document: TextDocument): string
	{
		let previousDivision = "";
		let previousLocator = "";
		const segments = document.segments.map((segment) =>
		{
			const divisionValue = segment.division?.type === "book" ? segment.division.label : "";
			const startsDivision = divisionValue.length > 0 && divisionValue !== previousDivision;
			const heading = startsDivision ? `<h2 class="book-heading" data-book-heading="${EscapeHtml(divisionValue)}">Book ${EscapeHtml(this.FormatBookNumber(divisionValue))}</h2>` : "";
			previousDivision = divisionValue;
			const bookTarget = startsDivision ? ` data-book-start="${EscapeHtml(divisionValue)}"` : "";
			const locatorValue = segment.citation?.value ?? "";
			const startsLocator = locatorValue.length > 0 && locatorValue !== previousLocator;
			const locatorMarkup = startsLocator ? `<span class="source-locator">${EscapeHtml(locatorValue)}</span>` : "";
			const locatorClass = startsLocator ? "has-locator" : "";
			const locatorTarget = startsLocator ? ` data-locator="${EscapeHtml(locatorValue)}"` : "";
			previousLocator = locatorValue;
			const segmentText = this.RenderSegmentText(segment);
			const segmentMarkup = `<p class="text-segment ${locatorClass}" data-segment-key="${EscapeHtml(segment.key)}"${bookTarget}${locatorTarget}>${locatorMarkup}<span class="segment-text">${segmentText}</span></p>`;
			return `${heading}${segmentMarkup}`;
		}).join("");
		return segments;
	}

	// Renders semantic quotation ranges without changing the segment's canonical text content.
	private RenderSegmentText(segment: TextSegment): string
	{
		const markup = RenderSemanticText(segment.text, segment.annotations);

		return markup;
	}

	// Renders the compact text, passage, search, and reading-settings toolbar.
	private RenderReaderToolbar(document: TextDocument): string
	{
		const books = document.segments.map((segment) => segment.division).filter((division, index, divisions) => division?.type === "book" && divisions.findIndex((candidate) => candidate?.type === "book" && candidate.label === division.label) === index);
		const bookControl = books.length === 0 ? "" : `<label class="reader-control reader-book-control"><select data-book-navigation aria-label="Go to book">${books.map((book) => `<option value="${EscapeHtml(book?.label ?? "")}">Book ${EscapeHtml(this.FormatBookNumber(book?.label ?? ""))}</option>`).join("")}</select></label>`;
		const locators = this.CollectLocators(document);
		const locatorOptions = locators.map((locator) => `<option value="${EscapeHtml(locator)}">${EscapeHtml(locator)}</option>`).join("");
		const locatorControl = locators.length === 0 ? "" : `<label class="reader-control reader-locator-select"><select data-locator-navigation aria-label="Choose Stephanus passage">${locatorOptions}</select></label>`;
		const passageControl = bookControl.length === 0 && locatorControl.length === 0 ? "" : `<div class="reader-passage-control"><button class="reader-icon-button button-control" data-passage-step="-1" type="button" title="Previous passage" aria-label="Previous passage">${PreviousIcon}</button>${bookControl}${bookControl.length > 0 && locatorControl.length > 0 ? `<span class="reader-passage-divider" aria-hidden="true"></span>` : ""}${locatorControl}<button class="reader-icon-button button-control" data-passage-step="1" type="button" title="Next passage" aria-label="Next passage">${NextIcon}</button></div>`;
		const historyControl = `<div class="reader-history-controls" role="group" aria-label="Reading history"><button class="reader-icon-button button-control" data-reader-history="back" type="button" title="Back" aria-label="Back" disabled>${PreviousIcon}</button><button class="reader-icon-button button-control" data-reader-history="forward" type="button" title="Forward" aria-label="Forward" disabled>${NextIcon}</button></div>`;
		const search = `<details class="action-menu reader-search-menu"><summary data-find-toggle title="Find in text" aria-label="Find in text">${SearchIcon}</summary><div class="action-menu-items reader-search-popover"><div class="application-find"><input class="control-input" data-find-input type="search" placeholder="Find in text..." aria-label="Find in text"><span data-find-count aria-live="polite"></span><button data-find-prev type="button" title="Previous match" aria-label="Previous match">${PreviousIcon}</button><button data-find-next type="button" title="Next match" aria-label="Next match">${NextIcon}</button><button data-find-close type="button" title="Close search" aria-label="Close search">${CloseIcon}</button></div></div></details>`;
		const toolbar = `<header class="reader-toolbar"><div class="reader-toolbar-line"><div class="reader-passage-navigation">${historyControl}${passageControl}</div><div class="reader-tools">${search}</div></div></header>`;
		return toolbar;
	}

	// Renders source and license metadata after the text instead of consuming toolbar space.
	private RenderSourceAttribution(document: TextDocument, sourceNotice: SourceNotice | null): string
	{
		const source = sourceNotice?.source ?? document.provenance.repository;
		const license = sourceNotice?.license ?? document.provenance.license;
		const attribution = [source, license].filter(Boolean).join(" · ");
		return attribution.length === 0 ? "" : `<footer class="reader-source-attribution">${EscapeHtml(attribution)}</footer>`;
	}

	// Returns each distinct Stephanus locator value in document order.
	private CollectLocators(document: TextDocument): string[]
	{
		const locators: string[] = [];
		const seen = new Set<string>();

		for (const segment of document.segments)
		{
			const value = segment.citation?.value ?? "";
			if (value.length > 0 && !seen.has(value))
			{
				seen.add(value);
				locators.push(value);
			}
		}

		return locators;
	}

	// Jumps to the book selected from the book-navigation control.
	private HandleChange(event: Event): void
	{
		const target = event.target;
		const bookNavigation = target instanceof HTMLSelectElement && target.matches("[data-book-navigation]") ? target : null;
		if (bookNavigation !== null) this.JumpToBook(bookNavigation.value);
		if (target instanceof HTMLSelectElement && target.matches("[data-locator-navigation]") && target.value.length > 0)
		{
			this.JumpToLocator(target.value);
		}
	}

	// Keeps passage controls aligned with the reader's current focus without interrupting locator entry.
	private HandleFocusChanged(event: ChoraEvents["library.focus-changed"]): void
	{
		const text = this.library.GetText();
		if (text !== null && text.id === event.textId)
		{
			const segment = text.segments.find(function MatchesSegment(candidate): boolean { return candidate.key === event.segmentKey; });
			const locator = segment?.citation?.value ?? "";
			const chooser = this.root.querySelector<HTMLSelectElement>("[data-locator-navigation]");
			const book = this.root.querySelector<HTMLSelectElement>("[data-book-navigation]");
			if (chooser !== null) chooser.value = locator;
			if (book !== null && segment?.division?.type === "book") book.value = segment.division.label;
		}
	}

	// Clears search highlighting when the popup query is emptied.
	private HandleInput(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		if (target instanceof HTMLInputElement && target.matches("[data-find-input]") && target.value.length === 0)
		{
			this.RunFind("", true);
		}
	}

	// Runs search from the popup and dismisses it with Escape.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const target = event.target as HTMLElement | null;
		const isFind = target?.matches("[data-find-input]") === true;

		if (event.key === "Enter" && isFind)
		{
			event.preventDefault();
			const forward = !event.shiftKey;
			this.RunFind((target as HTMLInputElement).value, forward);
		}
		if (event.key === "Escape" && isFind)
		{
			event.preventDefault();
			this.CloseFind();
		}
	}

	// Moves to the next or previous find match from the find-navigation buttons.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const isNext = target?.closest("[data-find-next]") != null;
		const isPrev = target?.closest("[data-find-prev]") != null;
		const history = target?.closest<HTMLElement>("[data-reader-history]")?.dataset.readerHistory;

		if (target?.closest("[data-welcome-open-library]") !== null)
		{
			void this.controller.OpenPreferredAsync();
		}

		if (isNext || isPrev)
		{
			const query = this.root.querySelector<HTMLInputElement>("[data-find-input]")?.value ?? "";
			this.RunFind(query, isNext);
		}
		if (target?.closest("[data-find-close]") !== null) this.CloseFind();
		if (history === "back" || history === "forward") this.NavigateHistory(history);
		const step = target?.closest<HTMLElement>("[data-passage-step]")?.dataset.passageStep;
		const document = this.library.GetText();
		if (step !== undefined && document !== null)
		{
			const locators = this.CollectLocators(document);
			const chooser = this.root.querySelector<HTMLSelectElement>("[data-locator-navigation]");
			const currentIndex = locators.indexOf(chooser?.value ?? "");
			const nextIndex = Math.max(0, Math.min(locators.length - 1, currentIndex + Number(step)));
			const locator = locators[nextIndex];
			if (locator !== undefined) this.JumpToLocator(locator);
		}
	}

	// Clears find state, closes the popup, and returns focus to its toolbar button.
	private CloseFind(): void
	{
		this.RunFind("", true);
		const menu = this.root.querySelector<HTMLDetailsElement>(".reader-search-menu");
		if (menu !== null)
		{
			menu.open = false;
			menu.querySelector<HTMLElement>("summary")?.focus();
		}
	}

	// Scrolls to the segment whose Stephanus locator matches the given value.
	private JumpToLocator(value: string): void
	{
		const normalized = value.trim().toLocaleLowerCase();

		if (normalized.length > 0)
		{
			const segments = Array.from(this.root.querySelectorAll<HTMLElement>("[data-locator]"));
			let match: HTMLElement | null = null;

			for (const segment of segments)
			{
				const locator = (segment.dataset.locator ?? "").toLocaleLowerCase();
				if (locator === normalized)
				{
					match = segment;
					break;
				}
			}

			if (match !== null) this.ScrollToSegment(match);
			const chooser = this.root.querySelector<HTMLSelectElement>("[data-locator-navigation]");
			if (match !== null && chooser !== null) chooser.value = match.dataset.locator ?? value;
		}
	}

	// Scrolls a segment into view below the toolbar and records it as the reading focus.
	private ScrollToSegment(segment: HTMLElement, recordHistory = true): void
	{
		const segmentKey = segment.dataset.segmentKey;
		if (recordHistory && segmentKey !== undefined) this.RecordNavigation(segmentKey);
		const toolbar = this.root.querySelector<HTMLElement>(".reader-toolbar");
		const rootBounds = this.scrollRoot.getBoundingClientRect();
		const segmentBounds = segment.getBoundingClientRect();
		const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
		const targetPosition = this.scrollRoot.scrollTop + segmentBounds.top - rootBounds.top - toolbarHeight - 16;
		this.scrollRoot.scrollTop = Math.max(0, targetPosition);

		if (segmentKey !== undefined) this.SetReadingFocus(segmentKey);
	}

	// Highlights every occurrence of the query and focuses the first or next match.
	private RunFind(query: string, forward: boolean): void
	{
		const trimmed = query.trim();
		const isRepeat = this.findHits.length > 0 && trimmed.toLocaleLowerCase() === this.activeFindQuery;

		if (isRepeat)
		{
			this.MoveFind(forward ? 1 : -1);
		}
		else
		{
			this.ClearFindHighlights();
			if (trimmed.length > 0)
			{
				this.HighlightMatches(trimmed);
				this.activeFindQuery = trimmed.toLocaleLowerCase();
				this.findIndex = 0;
				this.FocusFindHit();
			}
			this.UpdateFindCount();
		}
	}

	// Wraps every occurrence of the query in each segment with a highlight mark.
	private HighlightMatches(query: string): void
	{
		const lowerQuery = query.toLocaleLowerCase();
		const segments = this.root.querySelectorAll<HTMLElement>(".segment-text");

		segments.forEach((element) =>
		{
			const text = element.textContent ?? "";
			const lowerText = text.toLocaleLowerCase();
			if (lowerText.includes(lowerQuery)) element.innerHTML = this.BuildHighlightedHtml(text, lowerText, lowerQuery);
		});

		this.findHits = Array.from(this.root.querySelectorAll<HTMLElement>("mark.find-hit"));
	}

	// Builds segment markup with every query occurrence wrapped in a highlight mark.
	private BuildHighlightedHtml(text: string, lowerText: string, lowerQuery: string): string
	{
		let html = "";
		let cursor = 0;
		let index = lowerText.indexOf(lowerQuery, cursor);

		while (index !== -1)
		{
			const prefix = text.slice(cursor, index);
			const matchText = text.slice(index, index + lowerQuery.length);
			html += `${EscapeHtml(prefix)}<mark class="find-hit">${EscapeHtml(matchText)}</mark>`;
			cursor = index + lowerQuery.length;
			index = lowerText.indexOf(lowerQuery, cursor);
		}

		html += EscapeHtml(text.slice(cursor));
		return html;
	}

	// Removes find highlights and resets find-navigation state.
	private ClearFindHighlights(): void
	{
		const parents = new Set<HTMLElement>();
		this.root.querySelectorAll<HTMLElement>("mark.find-hit").forEach((mark) =>
		{
			const parent = mark.parentElement;
			if (parent !== null) parents.add(parent);
		});
		parents.forEach((element) =>
		{
			const text = element.textContent ?? "";
			element.textContent = text;
		});
		this.findHits = [];
		this.findIndex = 0;
		this.activeFindQuery = "";
	}

	// Moves the focused find match forward or backward, wrapping at either end.
	private MoveFind(delta: number): void
	{
		if (this.findHits.length > 0)
		{
			this.findIndex = (this.findIndex + delta + this.findHits.length) % this.findHits.length;
			this.FocusFindHit();
			this.UpdateFindCount();
		}
	}

	// Marks the current find match active and scrolls it into view.
	private FocusFindHit(): void
	{
		this.findHits.forEach((hit) => hit.classList.remove("active"));
		const hit = this.findHits[this.findIndex];

		if (hit !== undefined)
		{
			hit.classList.add("active");
			const segmentKey = hit.closest<HTMLElement>("[data-segment-key]")?.dataset.segmentKey;
			if (segmentKey !== undefined) this.RecordNavigation(segmentKey);
			hit.scrollIntoView({ behavior: "smooth", block: "center" });
			if (segmentKey !== undefined) this.SetReadingFocus(segmentKey);
		}
	}

	// Updates the find-match position indicator.
	private UpdateFindCount(): void
	{
		const count = this.root.querySelector<HTMLElement>("[data-find-count]");
		if (count !== null) count.textContent = this.findHits.length === 0 ? "" : `${this.findIndex + 1}/${this.findHits.length}`;
	}

	// Scrolls to the selected book heading below the toolbar.
	private JumpToBook(book: string): void
	{
		const bookHeading = this.root.querySelector<HTMLElement>(`[data-book-heading="${CSS.escape(book)}"]`);
		const firstSegment = this.root.querySelector<HTMLElement>(`[data-book-start="${CSS.escape(book)}"]`);
		const toolbar = this.root.querySelector<HTMLElement>(".reader-toolbar");

		if (bookHeading !== null && firstSegment !== null)
		{
			const segmentKey = firstSegment.dataset.segmentKey;
			if (segmentKey !== undefined) this.RecordNavigation(segmentKey);
			const rootBounds = this.scrollRoot.getBoundingClientRect();
			const headingBounds = bookHeading.getBoundingClientRect();
			const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 0;
			const targetPosition = this.scrollRoot.scrollTop + headingBounds.top - rootBounds.top - toolbarHeight - 16;
			this.scrollRoot.scrollTop = Math.max(0, targetPosition);

			if (segmentKey !== undefined) this.SetReadingFocus(segmentKey);
		}
	}

	// Formats a book division value as a Roman numeral, falling back to the raw value.
	private FormatBookNumber(value: string): string
	{
		const romanNumbers = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
		const index = Number.parseInt(value, 10) - 1;
		const formatted = romanNumbers[index] ?? value;

		return formatted;
	}

	// Captures the reader's raw browser selection and reports it to the controller.
	private CaptureCurrentSelection(): void
	{
		const document = this.library.GetText();
		if (document !== null) this.controller.SetSelection(CaptureSelection(document));
	}

	private HandleSelectionDragStart(event: DragEvent): void
	{
		const target = event.target as HTMLElement | null;
		const document = this.library.GetText();
		const dataTransfer = event.dataTransfer;
		if (target?.closest(".segment-text") === null || target === null || document === null || dataTransfer === null || dataTransfer === undefined) return;
		const selection = CaptureSelection(document);
		if (selection === null) return;
		const payload = CreateVisionReferencePayload(selection, document.GetSingleGreekWordSelection(selection));
		dataTransfer.effectAllowed = "copy";
		dataTransfer.setData(VisionReferenceDragMime, SerializeVisionReferenceDrag(payload));
		dataTransfer.setData("text/plain", document.ReconstructText(selection));
		this.controller.SetSelection(selection);
	}

	private HandleCopy(event: ClipboardEvent): void
	{
		const document = this.library.GetText();
		const clipboard = event.clipboardData;
		if (document === null || clipboard === null) return;
		const selection = CaptureSelection(document);
		if (selection === null) return;
		const payload = CreateVisionReferencePayload(selection, document.GetSingleGreekWordSelection(selection));
		const selectedText = document.ReconstructText(selection);
		event.preventDefault();
		clipboard.setData(VisionReferenceDragMime, SerializeVisionReferenceDrag(payload));
		clipboard.setData("text/html", SerializeVisionReferenceClipboardHtml(payload, selectedText));
		clipboard.setData("text/plain", selectedText);
		this.controller.SetSelection(selection);
	}

	// Captures the selection under the pointer and shows the selection context menu.
	private async HandleContextMenuAsync(event: Event): Promise<void>
	{
		const document = this.library.GetText();
		const browserSelection = document === null ? null : CaptureSelection(document);
		this.controller.SetSelection(browserSelection);
		const selection = this.library.GetSelection();

		if (selection !== null)
		{
			event.preventDefault();
			await this.controller.HandleSelectionActionAsync(selection);
		}
	}

	// Scrolls requested components into view and clears the browser's native selection.
	private JumpToSelections(selections: readonly TextSelection[], navigationTarget: "source" | "word"): void
	{
		const firstSelection = selections[0];
		if (firstSelection !== undefined) this.RecordNavigation(firstSelection.start.stephanus);
		this.ClearFindHighlights();
		this.ClearWordHighlights();
		if (navigationTarget === "source") this.ClearSourceHighlights();
		const firstSegment = this.HighlightSelections(selections, navigationTarget);
		this.RenderWordHighlights();
		firstSegment?.scrollIntoView({ behavior: "smooth", block: "center" });
		if (firstSegment !== null && firstSelection !== undefined) this.SetReadingFocus(firstSelection.start.stephanus);
		ClearBrowserSelection();
	}

	// Applies exact source or word decorations and returns the first covered segment.
	private HighlightSelections(selections: readonly TextSelection[], targetKind: "source" | "word"): HTMLElement | null
	{
		const document = this.library.GetText();
		const renderedSegments = Array.from(this.root.querySelectorAll<HTMLElement>("[data-segment-key]"));
		let firstSegment: HTMLElement | null = null;

		for (const selection of selections)
		{
			const startIndex = renderedSegments.findIndex(function FindStart(candidate): boolean
			{
				return candidate.dataset.segmentKey === selection.start.stephanus;
			});
			const endIndex = renderedSegments.findIndex(function FindEnd(candidate): boolean
			{
				return candidate.dataset.segmentKey === selection.end.stephanus;
			});

			if (document !== null && selection.dialogue === document.id && startIndex >= 0 && endIndex >= startIndex)
			{
				const targets = renderedSegments.slice(startIndex, endIndex + 1);
				firstSegment ??= targets[0] ?? null;
				for (const [targetIndex, target] of targets.entries())
				{
					const sourceSegmentIndex = startIndex + targetIndex;
					const sourceSegment = document.segments[sourceSegmentIndex];
					if (sourceSegment === undefined) continue;
					const from = sourceSegmentIndex === startIndex ? selection.start.offset : 0;
					const to = sourceSegmentIndex === endIndex ? selection.end.offset : sourceSegment.text.length;
					if (targetKind === "source")
					{
						this.HighlightSourceText(target, sourceSegment.text, from, to);
					}
					else
					{
						this.HighlightText(target, from, to, "word-focus-target");
					}
				}
			}
		}

		return firstSegment;
	}

	// Removes prior exact source decorations without changing the surrounding segment structure.
	private ClearSourceHighlights(): void
	{
		const highlights = Array.from(this.root.querySelectorAll<HTMLElement>(".source-focus-target"));

		for (const highlight of highlights)
		{
			const parent = highlight.parentNode;
			highlight.replaceWith(document.createTextNode(highlight.textContent ?? ""));
			parent?.normalize();
		}
	}

	private ClearWordHighlights(): void
	{
		const nodes = this.root.querySelectorAll<HTMLElement>(".word-focus-target");
		const highlights = Array.from(nodes);
		for (const highlight of highlights)
		{
			const parent = highlight.parentNode;
			const children = Array.from(highlight.childNodes);
			highlight.replaceWith(...children);
			parent?.normalize();
		}
	}

	// Reapplies all active lemma occurrences after reader DOM or navigation changes.
	private RenderWordHighlights(): void
	{
		this.ClearWordHighlights();
		this.HighlightSelections(this.wordHighlights, "word");
	}

	// Wraps only the canonical character range belonging to one selected source segment.
	private HighlightSourceText(segment: HTMLElement, canonicalText: string, from: number, to: number): void
	{
		const textElement = segment.querySelector<HTMLElement>(".segment-text");
		const start = Math.max(0, Math.min(canonicalText.length, from));
		const end = Math.max(start, Math.min(canonicalText.length, to));

		if (textElement !== null && start < end)
		{
			const prefix = EscapeHtml(canonicalText.slice(0, start));
			const selected = EscapeHtml(canonicalText.slice(start, end));
			const suffix = EscapeHtml(canonicalText.slice(end));
			textElement.innerHTML = `${prefix}<span class="source-focus-target">${selected}</span>${suffix}`;
		}
	}

	// Adds an exact inline highlight without replacing existing source decoration.
	private HighlightText(segment: HTMLElement, from: number, to: number, highlightClass: string): void
	{
		const textElement = segment.querySelector<HTMLElement>(".segment-text");
		const textLength = textElement?.textContent?.length ?? 0;
		const start = Math.max(0, Math.min(textLength, from));
		const end = Math.max(start, Math.min(textLength, to));

		if (textElement !== null && start < end)
		{
			const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
			const ranges: Array<{ node: Text; start: number; end: number }> = [];
			let node = walker.nextNode();
			let offset = 0;

			while (node !== null)
			{
				const textNode = node as Text;
				const nodeEnd = offset + textNode.data.length;
				const rangeStart = Math.max(start, offset);
				const rangeEnd = Math.min(end, nodeEnd);

				if (rangeStart < rangeEnd)
				{
					ranges.push({
						node: textNode,
						start: rangeStart - offset,
						end: rangeEnd - offset
					});
				}

				offset = nodeEnd;
				node = walker.nextNode();
			}

			for (let index = ranges.length - 1; index >= 0; index -= 1)
			{
				const item = ranges[index];
				if (item === undefined) continue;
				const range = document.createRange();
				range.setStart(item.node, item.start);
				range.setEnd(item.node, item.end);
				const highlight = document.createElement("span");
				highlight.className = highlightClass;
				range.surroundContents(highlight);
			}
		}
	}

	// Schedules a debounced capture of the segment at the top reading edge.
	private ScheduleReadingFocus(): void
	{
		if (this.focusTimer !== null) clearTimeout(this.focusTimer);
		this.focusTimer = setTimeout(this.HandleFocusTimer.bind(this), 100);
	}

	// Captures the reading focus once a pending debounce timer elapses.
	private HandleFocusTimer(): void
	{
		this.focusTimer = null;
		this.CaptureReadingFocus();
	}

	// Records the first segment visible below the toolbar as the reading focus.
	private CaptureReadingFocus(): void
	{
		const viewport = this.scrollRoot.getBoundingClientRect();
		const toolbar = this.root.querySelector<HTMLElement>(".reader-toolbar");
		const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? viewport.top;
		const readingTop = Math.max(viewport.top, toolbarBottom) + 16;
		let closest: HTMLElement | null = null;
		let distance = Number.POSITIVE_INFINITY;
		const segmentNodes = this.root.querySelectorAll<HTMLElement>("[data-segment-key]");
		const segments = Array.from(segmentNodes);

		for (const segment of segments)
		{
			const bounds = segment.getBoundingClientRect();
			const segmentDistance = Math.max(0, bounds.top - readingTop);
			if (bounds.bottom > readingTop && bounds.top < viewport.bottom && segmentDistance < distance)
			{
				closest = segment;
				distance = segmentDistance;
			}
		}

		const segmentKey = closest?.dataset.segmentKey;
		if (segmentKey !== undefined) this.SetReadingFocus(segmentKey);
	}

	private RecordNavigation(destination: string): void
	{
		const current = this.focusedSegmentKey;
		if (current !== null && current !== destination)
		{
			if (this.historyBack.at(-1) !== current) this.historyBack.push(current);
			this.historyForward.length = 0;
			this.UpdateHistoryControls();
		}
	}

	private NavigateHistory(direction: "back" | "forward"): void
	{
		const source = direction === "back" ? this.historyBack : this.historyForward;
		const destination = source.pop();
		if (destination === undefined) return;
		const opposite = direction === "back" ? this.historyForward : this.historyBack;
		if (this.focusedSegmentKey !== null && opposite.at(-1) !== this.focusedSegmentKey)
			opposite.push(this.focusedSegmentKey);
		const segment = this.root.querySelector<HTMLElement>(`[data-segment-key="${CSS.escape(destination)}"]`);
		if (segment !== null) this.ScrollToSegment(segment, false);
		this.UpdateHistoryControls();
	}

	private SetReadingFocus(segmentKey: string): void
	{
		this.focusedSegmentKey = segmentKey;
		this.controller.SetFocusSegment(segmentKey);
	}

	private UpdateHistoryControls(): void
	{
		const back = this.root.querySelector<HTMLButtonElement>('[data-reader-history="back"]');
		const forward = this.root.querySelector<HTMLButtonElement>('[data-reader-history="forward"]');
		if (back !== null) back.disabled = this.historyBack.length === 0;
		if (forward !== null) forward.disabled = this.historyForward.length === 0;
	}
}
