import type {
	WordDictionaryEntry,
	WordEvidenceResult,
	WordEvidenceValue,
	WordOccurrence,
	WordPersonResearch
} from "../../../shared/library/WordExplorationTypes.js";
import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../../core/events/ChoraEventBus.js";
import { LayoutSettings } from "../../core/settings/LayoutSettingsStore.js";
import { EscapeHtml } from "../../ui/Html.js";
import { WordExplorationController } from "./WordExplorationController.js";
import { WordExplorationStore } from "./WordExplorationStore.js";

export class WordExplorationPanel
{
	private readonly unsubscribe: Unsubscribe;
	private readonly requestUnsubscribe: Unsubscribe;
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly inputHandler = this.HandleInput.bind(this);
	private readonly keyDownHandler = this.HandleKeyDown.bind(this);
	private readonly panePointerDownHandler = this.HandlePanePointerDown.bind(this);
	private readonly panePointerMoveHandler = this.HandlePanePointerMove.bind(this);
	private readonly panePointerUpHandler = this.HandlePanePointerUp.bind(this);
	private readonly windowResizeHandler = this.NormalizePaneHeight.bind(this);
	private readonly content: HTMLElement;
	private readonly title: HTMLElement;
	private dialogueOccurrenceSelections: TextSelection[] = [];
	private dismissed = false;
	private paneResize: { pointerId: number; startHeight: number; startY: number; handle: HTMLElement } | null = null;
	private observationTimer: ReturnType<typeof setTimeout> | null = null;

	public constructor(
		private readonly root: HTMLElement,
		events: ChoraEventBus<ChoraEvents>,
		private readonly store: WordExplorationStore,
		private readonly controller: WordExplorationController)
	{
		this.root.classList.add("word-exploration");
		this.root.innerHTML = `<div class="word-pane-resize-handle" data-resize-pane="word" role="separator" aria-label="Resize word lookup" aria-orientation="horizontal" tabindex="0"></div><header><h2 data-word-title>Word lookup</h2><button type="button" class="word-pane-close button-control" data-word-close aria-label="Close word lookup">Close</button></header>
			<div data-word-content aria-live="polite"></div>`;
		this.title = this.RequireElement<HTMLElement>("[data-word-title]");
		this.content = this.RequireElement<HTMLElement>("[data-word-content]");
		this.root.addEventListener("click", this.clickHandler, true);
		this.root.addEventListener("input", this.inputHandler);
		this.root.addEventListener("keydown", this.keyDownHandler);
		this.root.addEventListener("pointerdown", this.panePointerDownHandler);
		window.addEventListener("pointermove", this.panePointerMoveHandler);
		window.addEventListener("pointerup", this.panePointerUpHandler);
		window.addEventListener("pointercancel", this.panePointerUpHandler);
		window.addEventListener("resize", this.windowResizeHandler);
		this.unsubscribe = events.Subscribe("word.exploration-changed", this.Update.bind(this));
		this.requestUnsubscribe = events.Subscribe("word.exploration-requested", this.Show.bind(this));
		this.RestorePaneHeight();
		this.Update();
	}

	public Dispose(): void
	{
		this.root.removeEventListener("click", this.clickHandler, true);
		this.root.removeEventListener("input", this.inputHandler);
		this.root.removeEventListener("keydown", this.keyDownHandler);
		this.root.removeEventListener("pointerdown", this.panePointerDownHandler);
		window.removeEventListener("pointermove", this.panePointerMoveHandler);
		window.removeEventListener("pointerup", this.panePointerUpHandler);
		window.removeEventListener("pointercancel", this.panePointerUpHandler);
		window.removeEventListener("resize", this.windowResizeHandler);
		if (this.observationTimer !== null) clearTimeout(this.observationTimer);
		this.unsubscribe();
		this.requestUnsubscribe();
	}

	private RequireElement<T extends HTMLElement>(selector: string): T
	{
		const element = this.root.querySelector<T>(selector);
		if (element === null) throw new Error(`Missing word exploration element: ${selector}`);
		return element;
	}

	private Update(): void
	{
		const snapshot = this.store.GetSnapshot();
		this.root.hidden = snapshot.selection === null || this.dismissed;
		if (snapshot.selection === null)
		{
			this.title.textContent = "Word lookup";
			this.content.replaceChildren();
			return;
		}

		this.title.innerHTML = `Word lookup: <span lang="grc">${EscapeHtml(snapshot.selectedForm)}</span>`;
		let content = "";
		if (snapshot.loadingEvidence)
		{
			content += this.RenderPendingEvidence(snapshot.selection.dialogue);
		}
		else if (snapshot.evidence !== null)
		{
			content += this.RenderEvidence(
				snapshot.evidence,
				snapshot.selectedLemma,
				snapshot.observation,
				snapshot.loadingObservation,
				snapshot.personResearch,
				snapshot.loadingPersonResearch);
		}
		this.content.innerHTML = content;
		this.ApplyColumnLayout();
	}

	private ApplyColumnLayout(): void
	{
		const columns = Array.from(this.content.children).map((child) =>
		{
			if (child.classList.contains("word-lemma-section")) return "max-content";
			if (child.classList.contains("word-dictionary-section")) return "minmax(30rem, 1.5fr)";
			if (child.classList.contains("word-person-section")) return "minmax(32rem, 1.8fr)";
			if (child.classList.contains("word-occurrences-section")) return "minmax(22rem, 1fr)";
			if (child.classList.contains("word-related-section")) return "minmax(20rem, 1fr)";
			if (child.classList.contains("word-observation-section")) return "minmax(24rem, 1.2fr)";
			return "minmax(20rem, 1fr)";
		});
		this.content.style.gridTemplateColumns = columns.join(" ");
	}

	private Show(): void
	{
		this.dismissed = false;
		this.root.hidden = false;
	}

	private RenderPendingEvidence(dialogueId: string): string
	{
		const dialogue = this.FormatDialogue(dialogueId);
		let html = "<section class=\"word-lemma-section\" aria-busy=\"true\"><h3>Lemmas</h3></section>";
		html += "<section class=\"word-dictionary-section\" aria-busy=\"true\"><h3>Dictionary</h3><div class=\"word-dictionary-content\"></div></section>";
		html += `<section class="word-occurrences-section" aria-busy="true"><details open><summary class="word-occurrences-heading"><h3>Occurrences in the ${EscapeHtml(dialogue)}</h3><span></span></summary></details></section>`;
		html += "<section class=\"word-related-section\" aria-busy=\"true\"><h3>Related lemmas</h3></section>";
		html += "<section class=\"word-observation-section\" aria-busy=\"true\"><h3>Observations</h3><textarea disabled></textarea></section>";
		return html;
	}

	private RenderEvidence(
		evidence: WordEvidenceResult,
		selectedLemma: string | null,
		observation: string,
		loadingObservation: boolean,
		personResearch: WordPersonResearch | null,
		loadingPersonResearch: boolean): string
	{
		let html = "";
		html += "<section class=\"word-lemma-section\"><h3>Lemmas</h3>";
		if (evidence.possibilities.length === 0)
		{
			html += "<p class=\"word-lemma-empty\">No lemma candidates were returned.</p>";
		}
		html += "<div class=\"word-lemma-tabs tab-list\" role=\"tablist\" aria-label=\"Lemma candidates\">";
		for (let index = 0; index < evidence.possibilities.length; index += 1)
		{
			const possibility = evidence.possibilities[index];
			if (possibility !== undefined)
			{
				const selected = possibility.lemma === selectedLemma;
				html += `<button type="button" role="tab" data-word-lemma-index="${index}" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}" lang="grc">${EscapeHtml(possibility.lemma)}</button>`;
			}
		}
		html += "</div></section>";

		const dictionaryEntries = selectedLemma === null
			? []
			: evidence.dictionary.entries.filter((entry) =>
				entry.matchedTerm.normalize("NFC") === selectedLemma.normalize("NFC"));
		const dictionaryTitle = evidence.dictionary.entries.some((entry) => entry.provider.includes("lsj"))
			? "Dictionary (LSJ)"
			: "Dictionary";
		if (dictionaryEntries.length > 0)
		{
			html += `<section class="word-dictionary-section"><h3>${dictionaryTitle}</h3>`;
			html += "<div class=\"word-dictionary-content\">";
			for (const entry of dictionaryEntries)
			{
				html += "<article class=\"word-dictionary-source\">";
				html += this.RenderDictionaryEntry(entry);
				html += "</article>";
			}
			html += "</div></section>";
		}
		html += this.RenderPersonResearch(personResearch, loadingPersonResearch);

		if (selectedLemma !== null)
		{
			html += this.RenderDialogueForms(evidence, selectedLemma);
			html += this.RenderObservation(observation, loadingObservation);
		}
		return html;
	}

	private RenderPersonResearch(
		research: WordPersonResearch | null,
		loading: boolean): string
	{
		if (!loading && research === null) return "";
		let html = "<section class=\"word-person-section\"><h3>Person</h3>";
		if (loading)
		{
			return `${html}<p class="word-person-status">Researching this person and name…</p></section>`;
		}
		if (research?.summary === null || research === null)
		{
			html += "<p class=\"word-person-status\">No grounded person summary is available.</p>";
		}
		else
		{
			if (research.summary.person)
			{
				html += `<div class="word-person-summary"><h4>Identity</h4><p>${EscapeHtml(research.summary.person)}</p></div>`;
			}
			if (research.summary.nameMeaning)
			{
				html += `<div class="word-person-summary"><h4>Name</h4><p>${EscapeHtml(research.summary.nameMeaning)}</p></div>`;
			}
			if (research.summary.relationships.length > 0)
			{
				html += "<div class=\"word-person-summary\"><h4>Relationships</h4><ul>";
				for (const relationship of research.summary.relationships)
				{
					html += `<li>${EscapeHtml(relationship)}</li>`;
				}
				html += "</ul></div>";
			}
		}
		if (research !== null && research.sources.length > 0)
		{
			html += "<div class=\"word-person-sources\"><h4>Sources</h4>";
			for (const source of research.sources)
			{
				html += `<button type="button" data-person-source="${EscapeHtml(source.url)}"><span>${EscapeHtml(source.title)}</span><small>${EscapeHtml(source.provider)} · ${EscapeHtml(source.id)}</small></button>`;
			}
			html += "</div>";
		}
		return `${html}</section>`;
	}

	private RenderDictionaryEntry(entry: WordDictionaryEntry): string
	{
		const document = new DOMParser().parseFromString(entry.entryXml, "application/xml");
		if (document.querySelector("parsererror") !== null)
		{
			return `<div class="word-dictionary-entry"><p>${EscapeHtml(entry.plainText)}</p></div>`;
		}
		const content = this.RenderDictionaryNodes(document.documentElement.childNodes)
			.replace(/^\s*[,;:]\s*/u, "");
		return `<div class="word-dictionary-entry">${content}</div>`;
	}

	private RenderDictionaryNodes(nodes: NodeListOf<ChildNode>): string
	{
		return Array.from(nodes).map((node) => this.RenderDictionaryNode(node)).join("");
	}

	private RenderDictionaryNode(node: ChildNode): string
	{
		if (node.nodeType === Node.TEXT_NODE)
		{
			return EscapeHtml(node.textContent ?? "");
		}
		if (!(node instanceof Element)) return "";
		const content = this.RenderDictionaryNodes(node.childNodes);
		switch (node.tagName)
		{
			case "head":
				return "";
			case "sense":
			{
				const label = node.getAttribute("n");
				const heading = label === null ? "" : `<span class="word-dictionary-sense-label">${EscapeHtml(label)}</span>`;
				return `<section class="word-dictionary-sense">${heading}${content}</section>`;
			}
			case "i":
				return `<em>${content}</em>`;
			case "foreign":
			case "orth":
				return `<span lang="grc" class="word-dictionary-greek">${content}</span>`;
			case "gramGrp":
			case "gram":
			case "tns":
			case "mood":
			case "number":
			case "per":
				return `<span class="word-dictionary-grammar">${content}</span>`;
			case "cit":
				return `<span class="word-dictionary-citation">${content}</span>`;
			case "bibl":
			case "author":
			case "title":
				return `<span class="word-dictionary-reference">${content}</span>`;
			default:
				return content;
		}
	}

	private RenderDialogueForms(evidence: WordEvidenceResult, selectedLemma: string): string
	{
		const lemma = evidence.lemmas.find(function MatchesLemma(item)
		{
			return item.lemma === selectedLemma;
		});
		const rows = (lemma?.forms ?? []).flatMap((form) =>
			form.occurrences.map((occurrence) => ({ form: form.form, occurrence })));
		rows.sort((left, right) =>
		{
			const leftBook = Number(left.occurrence.division?.label ?? Number.MAX_SAFE_INTEGER);
			const rightBook = Number(right.occurrence.division?.label ?? Number.MAX_SAFE_INTEGER);
			return leftBook - rightBook
				|| left.occurrence.selection.start.stephanus.localeCompare(right.occurrence.selection.start.stephanus)
				|| left.occurrence.selection.start.offset - right.occurrence.selection.start.offset;
		});
		const dialogue = this.FormatDialogue(evidence.selection.dialogue);
		this.dialogueOccurrenceSelections = rows.map((row) => row.occurrence.selection);
		let html = `<section class="word-occurrences-section"><details open><summary class="word-occurrences-heading"><h3>Occurrences in the ${EscapeHtml(dialogue)}</h3><span>${rows.length}</span></summary>`;
		if (rows.length === 0)
		{
			html += "<p>No directly mapped occurrence was found in this dialogue.</p>";
		}
		for (let index = 0; index < rows.length; index += 1)
		{
			const row = rows[index];
			if (row === undefined) continue;
			const division = this.FormatDivision(row.occurrence);
			const citation = row.occurrence.citation ?? row.occurrence.selection.start.stephanus;
			const passage = this.HighlightOccurrence(row.occurrence, row.form);
			html += `<details class="word-occurrence-row"><summary><strong>${EscapeHtml(division)}</strong><button type="button" class="word-occurrence-location" data-word-occurrence-index="${index}" title="Go to ${EscapeHtml(citation)}">${EscapeHtml(citation)}</button><button type="button" class="word-occurrence-word" data-word-occurrence-index="${index}" title="Go to ${EscapeHtml(citation)}" lang="grc">${EscapeHtml(row.form)}</button></summary><div class="word-occurrence-expanded">${passage}</div></details>`;
		}
		html += "</details></section>";
		html += this.RenderRelatedLemmas(lemma?.relatedLemmas ?? []);
		return html;
	}

	private RenderRelatedLemmas(related: WordEvidenceResult["lemmas"][number]["relatedLemmas"]): string
	{
		if (related.length === 0) return "";
		let html = "<section class=\"word-related-section\"><h3>Related lemmas</h3>";
		for (const item of related)
		{
			const relation = this.FormatSlot(item.relationType);
			const presence = item.presentInDialogue ? `${item.total} in this dialogue` : "not in this dialogue";
			html += `<details class="word-related-row"><summary><strong lang="grc">${EscapeHtml(item.lemma)}</strong><span>${EscapeHtml(relation)} · ${presence}</span></summary>`;
			const providers = this.EvidenceProviders(item.evidence);
			if (providers.length > 0)
			{
				html += `<p class="word-exploration-note">Source: ${EscapeHtml(providers.join(", "))}.</p>`;
			}
			for (const form of item.forms)
			{
				html += `<details class="word-form-row"><summary><strong lang="grc">${EscapeHtml(form.form)}</strong><span class="word-form-count">${form.total}</span></summary>`;
				html += this.RenderDialogueOccurrences(form.occurrences, form.form);
				html += "</details>";
			}
			html += "</details>";
		}
		return `${html}</section>`;
	}

	private RenderObservation(value: string, loading: boolean): string
	{
		const disabled = loading ? " disabled" : "";
		const busy = loading ? " aria-busy=\"true\"" : "";
		const placeholder = loading ? "" : "Add your observations about this lemma…";
		return `<section class="word-observation-section"><h3>Observations</h3><textarea data-word-observation maxlength="50000" placeholder="${placeholder}"${disabled}${busy}>${EscapeHtml(value)}</textarea></section>`;
	}

	private RenderDialogueOccurrences(occurrences: readonly WordOccurrence[], form: string): string
	{
		let html = "<ol class=\"word-form-occurrences\">";
		for (const occurrence of occurrences)
		{
			const citation = occurrence.citation ?? occurrence.selection.start.stephanus;
			html += `<li><span class="word-occurrence-citation">${EscapeHtml(citation)}</span><span>${this.HighlightOccurrence(occurrence, form)}</span></li>`;
		}
		return `${html}</ol>`;
	}

	private HighlightOccurrence(occurrence: WordOccurrence, form: string): string
	{
		const start = occurrence.selection.start.offset;
		const end = occurrence.selection.end.offset;
		const selected = occurrence.passage.slice(start, end);
		if (occurrence.selection.start.stephanus === occurrence.selection.end.stephanus
			&& selected.normalize("NFC") === form.normalize("NFC"))
		{
			return `${EscapeHtml(occurrence.passage.slice(0, start))}<strong class="word-occurrence-form" lang="grc">${EscapeHtml(selected)}</strong>${EscapeHtml(occurrence.passage.slice(end))}`;
		}
		const fallback = occurrence.passage.indexOf(form);
		if (fallback < 0) return EscapeHtml(occurrence.passage);
		return `${EscapeHtml(occurrence.passage.slice(0, fallback))}<strong class="word-occurrence-form" lang="grc">${EscapeHtml(form)}</strong>${EscapeHtml(occurrence.passage.slice(fallback + form.length))}`;
	}

	private EvidenceProviders(evidence: readonly Readonly<Record<string, WordEvidenceValue>>[]): string[]
	{
		const providers = new Set<string>();
		for (const item of evidence)
		{
			if (typeof item.provider === "string") providers.add(item.provider);
		}
		return [...providers];
	}

	private FormatSlot(value: string): string
	{
		return value.replaceAll("_", " ");
	}

	private FormatDialogue(dialogueId: string): string
	{
		return dialogueId.charAt(0).toLocaleUpperCase() + dialogueId.slice(1);
	}

	private FormatDivision(occurrence: WordOccurrence): string
	{
		const division = occurrence.division;
		if (division === null) return "";
		const label = /^\d+$/u.test(division.label)
			? this.ToRoman(Number(division.label))
			: division.label;
		const type = division.type.charAt(0).toLocaleUpperCase() + division.type.slice(1);
		return `${type} ${label}`;
	}

	private ToRoman(value: number): string
	{
		const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
		return numerals[value] ?? String(value);
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const jump = target?.closest<HTMLElement>("[data-word-jump]");
		const occurrence = target?.closest<HTMLElement>("[data-word-occurrence-index]");
		const source = target?.closest<HTMLElement>("[data-person-source]");
		const lemma = target?.closest<HTMLElement>("[data-word-lemma-index]");
		const close = target?.closest<HTMLElement>("[data-word-close]");
		if (close !== null && close !== undefined)
		{
			this.dismissed = true;
			this.root.hidden = true;
		}
		else if (source !== null && source !== undefined)
		{
			const url = source.dataset.personSource;
			if (url !== undefined) void this.controller.OpenExternalSourceAsync(url);
		}
		else if (occurrence !== null && occurrence !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			const index = Number(occurrence.dataset.wordOccurrenceIndex);
			const selection = this.dialogueOccurrenceSelections[index];
			if (selection !== undefined) void this.controller.JumpAsync(selection);
		}
		else if (lemma !== null && lemma !== undefined)
		{
			const index = Number(lemma.dataset.wordLemmaIndex);
			const possibility = this.store.GetSnapshot().evidence?.possibilities[index];
			if (possibility !== undefined) void this.controller.SelectLemmaAsync(possibility.lemma);
		}
		else if (jump !== null && jump !== undefined)
		{
			const index = Number(jump.dataset.wordJump);
			const occurrence = this.store.GetSnapshot().result?.occurrences[index];
			if (occurrence !== undefined) void this.controller.JumpAsync(occurrence.selection);
		}
	}

	private HandleInput(event: Event): void
	{
		const target = event.target;
		if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-word-observation]")) return;
		this.store.SetObservation(target.value);
		if (this.observationTimer !== null) clearTimeout(this.observationTimer);
		this.observationTimer = setTimeout(() =>
		{
			this.observationTimer = null;
			void this.controller.SaveObservationAsync(target.value);
		}, 500);
	}

	private HandleKeyDown(event: KeyboardEvent): void
	{
		const resize = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-pane=\"word\"]");
		if (resize !== null && resize !== undefined
			&& (event.key === "ArrowUp" || event.key === "ArrowDown"))
		{
			event.preventDefault();
			const direction = event.key === "ArrowUp" ? 24 : -24;
			const height = this.ApplyPaneHeight(this.GetPaneHeight() + direction);
			LayoutSettings.SetDimension("wordPaneHeight", height);
			return;
		}
		const lemma = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-word-lemma-index]");
		if (lemma !== null && lemma !== undefined
			&& ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
		{
			const tabs = Array.from(this.root.querySelectorAll<HTMLElement>("[data-word-lemma-index]"));
			const current = tabs.indexOf(lemma);
			if (current < 0 || tabs.length === 0) return;
			event.preventDefault();
			let next = current;
			if (event.key === "Home") next = 0;
			else if (event.key === "End") next = tabs.length - 1;
			else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
			else next = (current + 1) % tabs.length;
			const tab = tabs[next];
			const index = Number(tab?.dataset.wordLemmaIndex);
			const possibility = this.store.GetSnapshot().evidence?.possibilities[index];
			if (tab !== undefined && possibility !== undefined)
			{
				tab.focus();
				void this.controller.SelectLemmaAsync(possibility.lemma);
			}
			return;
		}
	}

	private HandlePanePointerDown(event: PointerEvent): void
	{
		const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-pane=\"word\"]");
		if (handle === null || handle === undefined) return;
		event.preventDefault();
		handle.classList.add("is-active");
		this.paneResize = {
			pointerId: event.pointerId,
			startHeight: this.GetPaneHeight(),
			startY: event.clientY,
			handle
		};
	}

	private HandlePanePointerMove(event: PointerEvent): void
	{
		const resize = this.paneResize;
		if (resize === null || resize.pointerId !== event.pointerId) return;
		this.ApplyPaneHeight(resize.startHeight + resize.startY - event.clientY);
	}

	private HandlePanePointerUp(event: PointerEvent): void
	{
		const resize = this.paneResize;
		if (resize === null || resize.pointerId !== event.pointerId) return;
		resize.handle.classList.remove("is-active");
		this.paneResize = null;
		LayoutSettings.SetDimension("wordPaneHeight", this.GetPaneHeight());
	}

	private RestorePaneHeight(): void
	{
		const defaultHeight = Math.min(220, this.GetMaximumPaneHeight());
		const requested = LayoutSettings.GetDimension("wordPaneHeight", defaultHeight);
		const bounded = this.ApplyPaneHeight(requested);
		if (bounded !== requested) LayoutSettings.SetDimension("wordPaneHeight", bounded);
	}

	private NormalizePaneHeight(): void
	{
		const bounded = this.ApplyPaneHeight(this.GetPaneHeight());
		LayoutSettings.SetDimension("wordPaneHeight", bounded);
	}

	private GetPaneHeight(): number
	{
		return Number.parseFloat(this.root.style.height)
			|| this.root.getBoundingClientRect().height
			|| 220;
	}

	private GetMaximumPaneHeight(): number
	{
		const shellHeight = this.root.closest<HTMLElement>(".shell")?.getBoundingClientRect().height;
		const available = shellHeight && shellHeight > 0
			? shellHeight
			: window.innerHeight || 800;
		return Math.max(160, Math.floor(available * 0.5));
	}

	private ApplyPaneHeight(requested: number): number
	{
		const bounded = Math.max(160, Math.min(requested, this.GetMaximumPaneHeight()));
		this.root.style.height = `${Math.round(bounded)}px`;
		return Math.round(bounded);
	}
}
