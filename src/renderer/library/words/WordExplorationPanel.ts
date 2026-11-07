import type {
	WordDictionaryEntry,
	WordEvidenceCandidate,
	WordEvidenceResult,
	WordEvidenceValue,
	WordOccurrence,
	WordPersonResearch,
	WordPersonSource
} from "../../../shared/library/WordExplorationTypes.js";
import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../../core/events/ChoraEventBus.js";
import { LayoutSettings, type LayoutDimension } from "../../core/settings/LayoutSettingsStore.js";
import { EscapeHtml } from "../../ui/Html.js";
import { CloseIcon, OpenIcon } from "../../ui/Icons.js";
import { FloatingPanel } from "../../ui/FloatingPanel.js";
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
	private columnResize: {
		pointerId: number;
		startX: number;
		left: HTMLElement;
		right: HTMLElement;
		leftWidth: number;
		rightWidth: number;
		handle: HTMLElement;
	} | null = null;
	private observationTimer: ReturnType<typeof setTimeout> | null = null;
	private nameNoteTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly floatingPanels = new Map<string, FloatingPanel>();

	public constructor(
		private readonly root: HTMLElement,
		events: ChoraEventBus<ChoraEvents>,
		private readonly store: WordExplorationStore,
		private readonly controller: WordExplorationController)
	{
		this.root.classList.add("word-exploration");
		this.root.innerHTML = `<div class="word-pane-resize-handle row-resize-handle" data-resize-pane="word" role="separator" aria-label="Resize word lookup" aria-orientation="horizontal" tabindex="0"></div><header><h2 data-word-title>Word lookup</h2><button type="button" class="word-pane-close floating-panel-close button-control" data-word-close title="Close word lookup" aria-label="Close word lookup">${CloseIcon}</button></header>
			<div data-word-content aria-live="polite"></div><footer class="word-pane-footer" aria-hidden="true"></footer>`;
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
		if (this.nameNoteTimer !== null) clearTimeout(this.nameNoteTimer);
		for (const panel of this.floatingPanels.values()) panel.Dispose();
		this.floatingPanels.clear();
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
				snapshot.nameNote,
				snapshot.loadingPersonResearch,
				snapshot.loadingNameNote);
		}
		this.content.innerHTML = content;
		this.ApplyColumnLayout();
		this.RefreshFloatingPanels();
	}

	private ApplyColumnLayout(): void
	{
		const sections = Array.from(this.content.children).filter(function IsSection(child): child is HTMLElement
		{
			return child instanceof HTMLElement && child.tagName === "SECTION";
		});
		for (const section of sections)
		{
			const definition = this.GetColumnDefinition(section);
			const storedWidth = LayoutSettings.GetDimension(definition.dimension, 0);
			if (storedWidth > 0) this.content.style.setProperty(definition.property, `${storedWidth}px`);
		}
		for (let index = 0; index < sections.length - 1; index += 1)
		{
			const left = sections[index];
			const right = sections[index + 1];
			if (left === undefined || right === undefined) continue;
			const handle = document.createElement("div");
			handle.className = "word-column-resize-handle column-resize-handle";
			handle.dataset.resizeWordColumns = "";
			handle.setAttribute("role", "separator");
			handle.setAttribute("aria-orientation", "vertical");
			handle.setAttribute("aria-label", `Resize ${this.GetColumnDefinition(left).label} and ${this.GetColumnDefinition(right).label}`);
			handle.tabIndex = 0;
			left.after(handle);
		}
		this.ApplyColumnTracks();
	}

	private ApplyColumnTracks(): void
	{
		const tracks: string[] = [];
		for (const child of Array.from(this.content.children))
		{
			if (child instanceof HTMLElement && child.matches("section"))
			{
				const definition = this.GetColumnDefinition(child);
				tracks.push(`var(${definition.property}, ${definition.track})`);
			}
			else if (child instanceof HTMLElement && child.matches("[data-resize-word-columns]"))
			{
				tracks.push("5px");
			}
		}
		this.content.style.gridTemplateColumns = tracks.join(" ");
	}

	private GetColumnDefinition(section: HTMLElement): {
		dimension: LayoutDimension;
		property: string;
		track: string;
		minimum: number;
		label: string;
	}
	{
		let definition: {
			dimension: LayoutDimension;
			property: string;
			track: string;
			minimum: number;
			label: string;
		} = {
			dimension: "wordRelatedWidth",
			property: "--word-related-width",
			track: "minmax(20rem, 1fr)",
			minimum: 180,
			label: "related lemmas"
		};
		if (section.classList.contains("word-lemma-section"))
		{
			definition = { dimension: "wordLemmaWidth", property: "--word-lemma-width", track: "max-content", minimum: 72, label: "lemmas" };
		}
		else if (section.classList.contains("word-analysis-section"))
		{
			definition = { dimension: "wordAnalysisWidth", property: "--word-analysis-width", track: "minmax(22rem, 1fr)", minimum: 180, label: "morphology" };
		}
		else if (section.classList.contains("word-dictionary-section"))
		{
			definition = { dimension: "wordDictionaryWidth", property: "--word-dictionary-width", track: "minmax(30rem, 1.5fr)", minimum: 240, label: "dictionary" };
		}
		else if (section.classList.contains("word-person-section"))
		{
			definition = { dimension: "wordPersonWidth", property: "--word-person-width", track: "minmax(32rem, 1.8fr)", minimum: 260, label: "name research" };
		}
		else if (section.classList.contains("word-occurrences-section"))
		{
			definition = { dimension: "wordOccurrencesWidth", property: "--word-occurrences-width", track: "minmax(22rem, 1fr)", minimum: 200, label: "occurrences" };
		}
		else if (section.classList.contains("word-observation-section"))
		{
			definition = { dimension: "wordObservationWidth", property: "--word-observation-width", track: "minmax(24rem, 1.2fr)", minimum: 220, label: "notes" };
		}

		return definition;
	}

	private Show(): void
	{
		this.dismissed = false;
		this.root.hidden = false;
	}

	private RenderPendingEvidence(dialogueId: string): string
	{
		const dialogue = this.FormatDialogue(dialogueId);
		let html = `<section class="word-lemma-section" aria-busy="true">${this.RenderColumnHeading("Lemmas")}</section>`;
		html += `<section class="word-analysis-section" aria-busy="true">${this.RenderColumnHeading("Morphology")}</section>`;
		html += `<section class="word-dictionary-section" aria-busy="true">${this.RenderColumnHeading("Dictionary")}<div class="word-dictionary-content"></div></section>`;
		html += `<section class="word-occurrences-section" aria-busy="true">${this.RenderColumnHeading(`Occurrences in the ${dialogue}`, "<span></span>", "word-occurrences-heading")}</section>`;
		html += `<section class="word-related-section" aria-busy="true">${this.RenderColumnHeading("Related lemmas")}</section>`;
		html += `<section class="word-observation-section" aria-busy="true">${this.RenderColumnHeading("Notes")}<textarea class="multiline-input" disabled></textarea></section>`;
		return html;
	}

	private RenderEvidence(
		evidence: WordEvidenceResult,
		selectedLemma: string | null,
		observation: string,
		loadingObservation: boolean,
		personResearch: WordPersonResearch | null,
		nameNote: string,
		loadingPersonResearch: boolean,
		loadingNameNote: boolean): string
	{
		let html = "";
		html += `<section class="word-lemma-section">${this.RenderColumnHeading("Lemmas")}`;
		if (evidence.possibilities.length === 0)
		{
			html += "<p class=\"word-lemma-empty\">No lemma candidates were returned.</p>";
		}
		html += "<div class=\"word-lemma-tabs tab-list\" role=\"tablist\" aria-label=\"Lemma candidates\" aria-orientation=\"vertical\">";
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

		if (selectedLemma !== null)
		{
			html += this.RenderMorphology(evidence, selectedLemma);
		}

		const dictionaryEntries = selectedLemma === null
			? []
			: evidence.dictionary.entries.filter((entry) =>
				entry.matchedTerm.normalize("NFC") === selectedLemma.normalize("NFC"));
		const dictionaryTitle = evidence.dictionary.entries.some((entry) => entry.provider.includes("lsj"))
			? "Dictionary (LSJ)"
			: "Dictionary";
		if (dictionaryEntries.length > 0)
		{
			html += `<section class="word-dictionary-section" data-word-section="dictionary">${this.RenderSectionHeading("dictionary", dictionaryTitle)}`;
			html += "<div class=\"word-dictionary-content\">";
			for (const entry of dictionaryEntries)
			{
				html += "<article class=\"word-dictionary-source\">";
				html += this.RenderDictionaryEntry(entry);
				html += "</article>";
			}
			html += "</div></section>";
		}
		html += this.RenderPersonResearch(
			personResearch, nameNote, loadingPersonResearch, loadingNameNote);

		if (selectedLemma !== null)
		{
			html += this.RenderDialogueForms(evidence, selectedLemma);
			html += this.RenderObservation(observation, loadingObservation);
		}
		return html;
	}

	/** Presents the source and grammatical readings of the reader-selected lemma. */
	private RenderMorphology(evidence: WordEvidenceResult, selectedLemma: string): string
	{
		let html = `<section class="word-analysis-section">${this.RenderColumnHeading("Morphology")}<div class="word-analysis-content">`;
		html += `<p class="word-analysis-context">Possible readings of <strong lang="grc">${EscapeHtml(evidence.form)}</strong> as <strong lang="grc">${EscapeHtml(selectedLemma)}</strong>.</p>`;
		let candidates: readonly WordEvidenceCandidate[] = [];
		for (const possibility of evidence.possibilities)
		{
			if (possibility.lemma === selectedLemma)
			{
				candidates = possibility.candidates;
			}
		}
		for (const candidate of candidates)
		{
			const grammar = this.FormatGrammar(candidate);
			html += "<article class=\"word-analysis-reading\">";
			if (candidate.homograph !== undefined && candidate.homograph !== null)
			{
				const identifier = candidate.headword ?? selectedLemma;
				html += `<p class="word-analysis-headword" title="${EscapeHtml(identifier)}"><span lang="grc">${EscapeHtml(selectedLemma)}</span> · entry ${EscapeHtml(candidate.homograph)}</p>`;
			}
			html += `<p class="word-analysis-grammar">${EscapeHtml(grammar)}</p></article>`;
		}
		if (candidates.length === 0)
		{
			html += "<p>No analysis supplied for this lemma.</p>";
		}
		if (evidence.warnings.length > 0)
		{
			html += `<details class="word-analysis-notices"><summary>Lookup notices (${evidence.warnings.length})</summary><ul>`;
			for (const warning of evidence.warnings)
			{
				html += `<li>${EscapeHtml(warning)}</li>`;
			}
			html += "</ul></details>";
		}
		html += "</div></section>";
		return html;
	}

	private RenderColumnHeading(title: string, trailing = "", extraClass = ""): string
	{
		const classes = `word-column-heading${extraClass.length > 0 ? ` ${extraClass}` : ""}`;
		return `<header class="${classes}"><h3>${EscapeHtml(title)}</h3>${trailing}</header>`;
	}

	private RenderSectionHeading(key: string, title: string, trailing = "", extraClass = ""): string
	{
		const floatButton = `<button type="button" class="word-section-float button-control" data-word-float="${EscapeHtml(key)}" data-word-float-title="${EscapeHtml(title)}" title="Open ${EscapeHtml(title)} in a floating window" aria-label="Open ${EscapeHtml(title)} in a floating window">${OpenIcon}</button>`;
		const classes = `word-section-heading${extraClass.length > 0 ? ` ${extraClass}` : ""}`;
		return this.RenderColumnHeading(title, `${trailing}${floatButton}`, classes);
	}

	/** Formats supplied grammatical features without presenting engine scores as certainty. */
	private FormatGrammar(candidate: WordEvidenceCandidate): string
	{
		const labels: string[] = [];
		const order = ["part_of_speech", "tense", "voice", "mood", "person", "number", "case", "gender", "dialect"];
		for (const name of order)
		{
			const feature = candidate.features?.[name];
			if (feature !== undefined && feature.length > 0)
			{
				const label = name === "person" ? `${feature} person` : feature;
				labels.push(label);
			}
		}
		let grammar = candidate.tag || "No grammatical parse supplied.";
		if (labels.length > 0)
		{
			grammar = labels.join(" · ");
		}
		return grammar;
	}

	/** Gives source identifiers readable names without requiring a fixed provider list. */
	private FormatProvider(value: string): string
	{
		const parts = value.split("-");
		const words: string[] = [];
		for (const part of parts)
		{
			const word = part.charAt(0).toLocaleUpperCase() + part.slice(1);
			words.push(word);
		}
		const name = words.join(" ");
		return name;
	}

	/** Presents a consolidated account with separate reader notes and source links. */
	private RenderPersonResearch(
		research: WordPersonResearch | null,
		note: string,
		loading: boolean,
		loadingNote: boolean): string
	{
		let html = "";
		if (loading)
		{
			html = `<section class="word-person-section" aria-busy="true">${this.RenderColumnHeading("Name research")}<div class="word-person-content"><p class="word-person-status">Researching this name…</p></div></section>`;
		}
		else if (research !== null)
		{
			html = `<section class="word-person-section" data-word-section="name-research">${this.RenderSectionHeading("name-research", "Name research")}<div class="word-person-content">`;
			if (research.overview.length > 0)
			{
				const paragraphs = research.overview.split(/\n\s*\n/u);
				for (const paragraph of paragraphs)
				{
					const escaped = EscapeHtml(paragraph);
					html += `<p class="word-name-overview">${escaped}</p>`;
				}
				html += this.RenderPersonSources(research.sources);
				if (research.warnings.length > 0)
				{
					html += "<div class=\"word-person-issues\" role=\"status\">";
					for (const warning of research.warnings)
					{
						const escaped = EscapeHtml(warning);
						html += `<p>${escaped}</p>`;
					}
					html += "</div>";
				}
			}
			else
			{
				const message = research.sources.length > 0
					? "Name research could not be summarized."
					: "No references were returned by the enabled sources.";
				html += `<p class="word-person-status">${message}</p>`;
			}
			const disabled = loadingNote ? " disabled" : "";
			const busy = loadingNote ? " aria-busy=\"true\"" : "";
			const placeholder = loadingNote ? "" : "Add notes about this name in this dialogue…";
			html += `<label class="word-person-note">Notes<textarea class="multiline-input" data-word-name-note maxlength="50000" placeholder="${placeholder}"${disabled}${busy}>${EscapeHtml(note)}</textarea></label>`;
			html += "</div></section>";
		}
		return html;
	}

	/** Lists each cited source once directly below the account. */
	private RenderPersonSources(sources: readonly WordPersonSource[]): string
	{
		const seen = new Set<string>();
		let links = "";
		for (const source of sources)
		{
			const identity = source.url.replace(/\/+$/u, "");
			if (!seen.has(identity))
			{
				seen.add(identity);
				const url = EscapeHtml(source.url);
				const title = EscapeHtml(source.title);
				const provider = EscapeHtml(source.provider);
				const reference = EscapeHtml(source.id);
				links += `<li><a href="${url}" data-person-source="${url}">[${reference}] ${provider} — ${title} ↗</a></li>`;
			}
		}
		return links.length > 0 ? `<ol class="word-person-sources">${links}</ol>` : "";
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
				return `<strong lang="grc">${content}</strong>`;
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
		const count = rows.length > 0 ? `${rows.length} mapped` : "Not established";
		const title = `Occurrences in the ${dialogue}`;
		const countBadge = `<span>${count}</span>`;
		let html = `<section class="word-occurrences-section" data-word-section="occurrences">${this.RenderSectionHeading("occurrences", title, countBadge, "word-occurrences-heading")}`;
		html += "<div class=\"word-occurrence-coverage\"><strong>Coverage</strong>";
		const inventoryProviders = evidence.coverage?.formInventoryProviders ?? [];
		const indexedCoverage = evidence.coverage?.morphologyIndexes ?? [];
		const cachedCoverage = evidence.coverage?.cachedFormCoverage ?? [];
		const providerNames: string[] = [];
		for (const provider of inventoryProviders)
		{
			if (indexedCoverage.some((coverage) => coverage.provider === provider)) continue;
			const name = this.FormatProvider(provider);
			providerNames.push(name);
		}
		for (const coverage of indexedCoverage)
		{
			const name = this.FormatProvider(coverage.provider);
			const checked = coverage.checkedForms.toLocaleString();
			const total = coverage.totalForms.toLocaleString();
			const unresolved = coverage.unresolvedForms.toLocaleString();
			if (coverage.wholeDialogueComplete)
			{
				html += `<p>PlatoSI indexed all ${total} dialogue forms with ${EscapeHtml(name)}. ${unresolved} forms had no analysis. These matches have not been checked in context.</p>`;
			}
			else
			{
				html += `<p>PlatoSI indexed ${checked} of ${total} dialogue forms with ${EscapeHtml(name)}. These matches have not been checked in context.</p>`;
				html += "<p>Unindexed forms may add occurrences.</p>";
			}
		}
		if (providerNames.length > 0)
		{
			const sources = providerNames.join(", ");
			html += `<p>Form inventories: ${EscapeHtml(sources)}. These matches have not been checked in context.</p>`;
		}
		else if (indexedCoverage.length === 0 && cachedCoverage.length === 0)
		{
			html += "<p>Complete source coverage is not established. These matches have not been checked in context.</p>";
		}
		for (const coverage of cachedCoverage)
		{
			const name = this.FormatProvider(coverage.provider);
			const checked = coverage.checkedForms.toLocaleString();
			const total = coverage.totalForms.toLocaleString();
			html += `<p>${EscapeHtml(name)}: ${checked} of ${total} dialogue forms checked. These matches have not been checked in context.</p>`;
			if (!coverage.wholeDialogueComplete)
			{
				html += "<p>Unchecked forms may add occurrences.</p>";
			}
		}
		for (const provider of evidence.coverage?.analysisOnlyProviders ?? [])
		{
			const name = this.FormatProvider(provider);
			html += `<p>${EscapeHtml(name)} supplies word analyses and has not verified these occurrence counts.</p>`;
		}
		html += "</div>";
		if (rows.length === 0)
		{
			html += "<p class=\"word-occurrence-empty\">No mapped matches were supplied. This does not establish that the lemma is absent.</p>";
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
		html += "</section>";
		html += this.RenderRelatedLemmas(lemma?.relatedLemmas ?? []);
		return html;
	}

	private RenderRelatedLemmas(related: WordEvidenceResult["lemmas"][number]["relatedLemmas"]): string
	{
		if (related.length === 0) return "";
		const title = `Related lemmas (${related.length})`;
		let html = `<section class="word-related-section" data-word-section="related">${this.RenderSectionHeading("related", title)}`;
		for (const item of related)
		{
			const relation = this.FormatSlot(item.relationType);
			const presence = item.presentInDialogue ? `${item.total} mapped matches` : "No mapped matches";
			html += `<details class="word-related-row"><summary><strong lang="grc">${EscapeHtml(item.lemma)}</strong><span>${EscapeHtml(relation)} · ${presence}</span></summary><div class="word-related-details">`;
			const providers = this.EvidenceProviders(item.evidence);
			if (providers.length > 0)
			{
				html += `<p class="word-exploration-note">Source: ${EscapeHtml(providers.join(", "))}.</p>`;
			}
			const definitions = item.dictionary?.entries ?? [];
			if (definitions.length > 0)
			{
				html += `<details class="word-related-dictionary"><summary>Dictionary (${definitions.length})</summary>`;
				for (const entry of definitions)
				{
					const source = entry.provider.includes("lsj") ? "LSJ" : this.FormatProvider(entry.provider);
					html += `<div class="word-related-definition"><h4>${EscapeHtml(source)}</h4>`;
					html += this.RenderDictionaryEntry(entry);
					html += "</div>";
				}
				html += "</details>";
			}
			else
			{
				html += "<p class=\"word-related-definition-empty\">No dictionary entry returned.</p>";
			}
			if (item.dictionary?.possiblyTruncated === true)
			{
				html += "<p class=\"word-related-definition-empty\">Additional dictionary entries are available.</p>";
			}
			for (const form of item.forms)
			{
				html += `<details class="word-form-row"><summary><strong lang="grc">${EscapeHtml(form.form)}</strong><span class="word-form-count">${form.total}</span></summary>`;
				html += this.RenderDialogueOccurrences(form.occurrences, form.form);
				html += "</details>";
			}
			html += "</div></details>";
		}
		return `${html}</section>`;
	}

	private RenderObservation(value: string, loading: boolean): string
	{
		const disabled = loading ? " disabled" : "";
		const busy = loading ? " aria-busy=\"true\"" : "";
		const placeholder = loading ? "" : "Add notes about this lemma…";
		return `<section class="word-observation-section" data-word-section="notes">${this.RenderSectionHeading("notes", "Notes")}<textarea class="multiline-input" data-word-observation maxlength="50000" placeholder="${placeholder}"${disabled}${busy}>${EscapeHtml(value)}</textarea></section>`;
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

	private RefreshFloatingPanels(): void
	{
		for (const [key, panel] of this.floatingPanels)
		{
			if (panel.IsOpen) this.PopulateFloatingPanel(key, panel);
		}
	}

	private OpenFloatingPanel(key: string): void
	{
		let panel = this.floatingPanels.get(key);
		if (panel === undefined)
		{
			panel = new FloatingPanel(key, "Word lookup");
			panel.OnBodyClick((event) => this.HandleClick(event));
			panel.OnBodyInput((event) => this.HandleInput(event));
			this.floatingPanels.set(key, panel);
		}
		if (this.PopulateFloatingPanel(key, panel)) panel.Open();
	}

	private PopulateFloatingPanel(key: string, panel: FloatingPanel): boolean
	{
		const section = this.content.querySelector<HTMLElement>(`[data-word-section="${key}"]`);
		if (section === null)
		{
			panel.Close();
			return false;
		}
		const clone = section.cloneNode(true) as HTMLElement;
		const heading = clone.querySelector<HTMLElement>(":scope > .word-section-heading");
		heading?.querySelector("[data-word-float]")?.remove();
		heading?.querySelector("h3")?.remove();
		if (heading?.childElementCount === 0) heading.remove();
		clone.classList.add("word-floating-section");
		const sourceHeading = section.querySelector<HTMLElement>(":scope > .word-section-heading");
		const title = sourceHeading?.querySelector("h3")?.textContent?.trim() ?? "Word lookup";
		panel.SetTitle(`${title}: ${this.store.GetSnapshot().selectedForm}`);
		panel.SetBody(clone);
		return true;
	}

	/** Routes delegated lookup actions. */
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const floating = target?.closest<HTMLElement>("[data-word-float]");
		const jump = target?.closest<HTMLElement>("[data-word-jump]");
		const occurrence = target?.closest<HTMLElement>("[data-word-occurrence-index]");
		const source = target?.closest<HTMLElement>("[data-person-source]");
		const lemma = target?.closest<HTMLElement>("[data-word-lemma-index]");
		const close = target?.closest<HTMLElement>("[data-word-close]");
		if (floating !== null && floating !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			const key = floating.dataset.wordFloat;
			if (key !== undefined) this.OpenFloatingPanel(key);
		}
		else if (close !== null && close !== undefined)
		{
			this.dismissed = true;
			this.root.hidden = true;
		}
		else if (source !== null && source !== undefined)
		{
			event.preventDefault();
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
		if (!(target instanceof HTMLTextAreaElement)) return;
		if (target.matches("[data-word-observation]"))
		{
			this.SyncTextareas("[data-word-observation]", target.value, target);
			this.store.SetObservation(target.value);
			if (this.observationTimer !== null) clearTimeout(this.observationTimer);
			this.observationTimer = setTimeout(() =>
			{
				this.observationTimer = null;
				void this.controller.SaveObservationAsync(target.value);
			}, 500);
		}
		else if (target.matches("[data-word-name-note]"))
		{
			this.SyncTextareas("[data-word-name-note]", target.value, target);
			this.store.SetNameNote(target.value);
			if (this.nameNoteTimer !== null) clearTimeout(this.nameNoteTimer);
			this.nameNoteTimer = setTimeout(() =>
			{
				this.nameNoteTimer = null;
				void this.controller.SaveNameNoteAsync(target.value);
			}, 500);
		}
	}

	private SyncTextareas(selector: string, value: string, source: HTMLTextAreaElement): void
	{
		for (const textarea of Array.from(
			document.querySelectorAll<HTMLTextAreaElement>(`.word-exploration ${selector}`)))
		{
			if (textarea !== source) textarea.value = value;
		}
	}

	private HandleKeyDown(event: KeyboardEvent): void
	{
		const columnResize = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-word-columns]");
		if (columnResize !== null && columnResize !== undefined
			&& (event.key === "ArrowLeft" || event.key === "ArrowRight"))
		{
			const left = columnResize.previousElementSibling;
			const right = columnResize.nextElementSibling;
			if (left instanceof HTMLElement && right instanceof HTMLElement)
			{
				event.preventDefault();
				const direction = event.key === "ArrowLeft" ? -24 : 24;
				this.ResizeColumnBoundary(left, right, direction, true);
			}
			return;
		}
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
			&& ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
		{
			const tabs = Array.from(this.root.querySelectorAll<HTMLElement>("[data-word-lemma-index]"));
			const current = tabs.indexOf(lemma);
			if (current < 0 || tabs.length === 0) return;
			event.preventDefault();
			let next = current;
			if (event.key === "Home") next = 0;
			else if (event.key === "End") next = tabs.length - 1;
			else if (event.key === "ArrowUp") next = (current - 1 + tabs.length) % tabs.length;
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
		const columnHandle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-word-columns]");
		const left = columnHandle?.previousElementSibling;
		const right = columnHandle?.nextElementSibling;
		if (columnHandle !== null && columnHandle !== undefined
			&& left instanceof HTMLElement && right instanceof HTMLElement)
		{
			event.preventDefault();
			columnHandle.classList.add("is-active");
			this.columnResize = {
				pointerId: event.pointerId,
				startX: event.clientX,
				left,
				right,
				leftWidth: this.GetColumnWidth(left),
				rightWidth: this.GetColumnWidth(right),
				handle: columnHandle
			};
			return;
		}
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
		const columnResize = this.columnResize;
		if (columnResize !== null && columnResize.pointerId === event.pointerId)
		{
			const delta = event.clientX - columnResize.startX;
			this.ResizeColumnBoundary(
				columnResize.left,
				columnResize.right,
				delta,
				false,
				columnResize.leftWidth,
				columnResize.rightWidth);
			return;
		}
		const resize = this.paneResize;
		if (resize === null || resize.pointerId !== event.pointerId) return;
		this.ApplyPaneHeight(resize.startHeight + resize.startY - event.clientY);
	}

	private HandlePanePointerUp(event: PointerEvent): void
	{
		const columnResize = this.columnResize;
		if (columnResize !== null && columnResize.pointerId === event.pointerId)
		{
			columnResize.handle.classList.remove("is-active");
			this.PersistColumnWidth(columnResize.left);
			this.PersistColumnWidth(columnResize.right);
			this.columnResize = null;
			return;
		}
		const resize = this.paneResize;
		if (resize === null || resize.pointerId !== event.pointerId) return;
		resize.handle.classList.remove("is-active");
		this.paneResize = null;
		LayoutSettings.SetDimension("wordPaneHeight", this.GetPaneHeight());
	}

	private ResizeColumnBoundary(
		left: HTMLElement,
		right: HTMLElement,
		delta: number,
		persist: boolean,
		initialLeftWidth = this.GetColumnWidth(left),
		initialRightWidth = this.GetColumnWidth(right)): void
	{
		const leftDefinition = this.GetColumnDefinition(left);
		const rightDefinition = this.GetColumnDefinition(right);
		const minimumDelta = leftDefinition.minimum - initialLeftWidth;
		const maximumDelta = initialRightWidth - rightDefinition.minimum;
		const boundedDelta = Math.max(minimumDelta, Math.min(delta, maximumDelta));
		const leftWidth = initialLeftWidth + boundedDelta;
		const rightWidth = initialRightWidth - boundedDelta;
		this.content.style.setProperty(leftDefinition.property, `${leftWidth}px`);
		this.content.style.setProperty(rightDefinition.property, `${rightWidth}px`);
		this.ApplyColumnTracks();
		if (persist)
		{
			LayoutSettings.SetDimension(leftDefinition.dimension, leftWidth);
			LayoutSettings.SetDimension(rightDefinition.dimension, rightWidth);
		}
	}

	private GetColumnWidth(section: HTMLElement): number
	{
		const definition = this.GetColumnDefinition(section);
		const propertyValue = this.content.style.getPropertyValue(definition.property);
		const explicitWidth = Number.parseFloat(propertyValue);
		const renderedWidth = section.getBoundingClientRect().width;
		const width = Number.isFinite(explicitWidth) && explicitWidth > 0
			? explicitWidth
			: Math.max(definition.minimum, renderedWidth);

		return width;
	}

	private PersistColumnWidth(section: HTMLElement): void
	{
		const definition = this.GetColumnDefinition(section);
		const width = this.GetColumnWidth(section);
		LayoutSettings.SetDimension(definition.dimension, width);
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
