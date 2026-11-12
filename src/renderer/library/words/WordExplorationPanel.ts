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
import { LayoutSettings, type SplitViewState } from "../../core/settings/LayoutSettingsStore.js";
import { EscapeHtml } from "../../ui/Html.js";
import { CloseIcon, DocumentIcon, OpenIcon } from "../../ui/Icons.js";
import { FloatingPanel } from "../../ui/controls/FloatingPanel.js";
import { ListViewControl, type ListViewItem } from "../../ui/controls/ListViewControl.js";
import { TabControl } from "../../ui/controls/TabControl.js";
import { SplitViewControl, type SplitPaneOptions } from "../../ui/controls/SplitViewControl.js";
import { TabPanel } from "../../ui/controls/TabPanel.js";
import { WordExplorationController } from "./WordExplorationController.js";
import { WordExplorationStore } from "./WordExplorationStore.js";
import { GetTextSelectionIdentity, WordVisionReferenceStore } from "./WordVisionReferenceStore.js";

class WordLookupTabPanel extends TabPanel
{
	public readonly Content: HTMLElement = document.createElement("div");

	public constructor(id: string, title: string)
	{
		super(id, title);
		this.Root.classList.add("word-lookup-tab-panel");
		this.Content.dataset.wordContent = "";
		this.Content.setAttribute("aria-live", "polite");
		this.Root.append(this.Content);
	}
}

export class WordExplorationPanel
{
	private readonly unsubscribe: Unsubscribe;
	private readonly requestUnsubscribe: Unsubscribe;
	private readonly referenceUnsubscribe: Unsubscribe;
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly inputHandler = this.HandleInput.bind(this);
	private content: HTMLElement = document.createElement("div");
	private readonly tabsHost: HTMLElement;
	private readonly tabs: TabControl;
	private readonly tabPanels = new Map<string, WordLookupTabPanel>();
	private dialogueOccurrenceSelections: TextSelection[] = [];
	private dialogueOccurrenceRows: Array<{ readonly form: string; readonly occurrence: WordOccurrence }> = [];
	private readonly selectedOccurrenceByTab = new Map<string, number>();
	private readonly occurrenceEvidence = new Map<string, WordEvidenceResult | null>();
	// Deduplicates detail requests when background research updates rerender the active tab.
	private readonly pendingOccurrences = new Set<string>();
	private disposed = false;
	private nameNoteTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly floatingPanels = new Map<string, FloatingPanel>();
	// Mounted selection controls for lemma choices and tab-local/floating occurrence navigation.
	private readonly selectionLists = new Map<HTMLElement, ListViewControl>();
	// Composed evidence groups use the same framework as the outer workspace.
	private readonly splitViews = new Map<HTMLElement, SplitViewControl>();

	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly store: WordExplorationStore,
		private readonly controller: WordExplorationController,
		private readonly visionReferences: WordVisionReferenceStore)
	{
		this.root.classList.add("word-exploration");
		this.root.innerHTML = `<div data-word-tabs></div><button type="button" class="word-pane-close control-window-close button-control" data-word-close title="Close word lookup" aria-label="Close word lookup">${CloseIcon}</button>`;
		this.tabsHost = this.RequireElement<HTMLElement>("[data-word-tabs]");
		this.tabs = new TabControl(
			[],
			"Open word lookups",
			(id) => { void this.controller.SelectTabAsync(id); },
			(id) => { void this.controller.CloseTabAsync(id); });
		this.tabs.Root.classList.add("word-lookup-tabs");
		this.tabsHost.append(this.tabs.Root);
		this.root.addEventListener("click", this.clickHandler, true);
		this.root.addEventListener("input", this.inputHandler);
		this.unsubscribe = events.Subscribe("word.exploration-changed", this.Update.bind(this));
		this.requestUnsubscribe = events.Subscribe("word.exploration-requested", this.Show.bind(this));
		this.referenceUnsubscribe = events.Subscribe("word.vision-references-changed", this.UpdateVisionReferences.bind(this));
		this.Update();
	}

	public Dispose(): void
	{
		this.disposed = true;
		this.root.removeEventListener("click", this.clickHandler, true);
		this.root.removeEventListener("input", this.inputHandler);
		if (this.nameNoteTimer !== null) clearTimeout(this.nameNoteTimer);
		for (const list of this.selectionLists.values())
		{
			list.Dispose();
		}
		this.selectionLists.clear();
		const views = Array.from(this.splitViews.values());
		for (const view of views.reverse())
		{
			view.Dispose();
		}
		this.splitViews.clear();
		for (const panel of this.floatingPanels.values()) panel.Dispose();
		this.floatingPanels.clear();
		this.tabs.Dispose();
		this.tabPanels.clear();
		this.unsubscribe();
		this.requestUnsubscribe();
		this.referenceUnsubscribe();
	}

	private RequireElement<T extends HTMLElement>(selector: string): T
	{
		const element = this.root.querySelector<T>(selector);
		if (element === null) throw new Error(`Missing word exploration element: ${selector}`);
		return element;
	}

	private Update(): void
	{
		this.SyncTabs();
		const snapshot = this.store.GetSnapshot();
		const hasLookup = this.store.GetActiveId() !== null;
		this.root.hidden = !hasLookup || !this.store.IsVisible();
		void this.events.PublishAsync("word.exploration-visibility-changed", { visible: !this.root.hidden });
		if (!hasLookup)
		{
			return;
		}
		const activeId = this.store.GetActiveId();
		const panel = activeId === null ? undefined : this.tabPanels.get(activeId);
		if (panel === undefined) return;
		this.tabs.Select(panel.Id);
		this.content = panel.Content;
		let content = "";
		if (snapshot.loadingEvidence)
		{
			content += this.RenderPendingEvidence(snapshot.selectedForm);
		}
		else if (snapshot.evidence !== null)
		{
			content += this.RenderEvidence(
				snapshot.evidence,
				snapshot.selectedLemma,
				snapshot.personResearch,
				snapshot.nameNote,
				snapshot.loadingPersonResearch,
				snapshot.loadingNameNote);
		}
		this.DisposeSelectionLists(this.content);
		this.content.innerHTML = content;
		this.MountSplitViews(this.content);
		this.MountOccurrenceLists(this.content);
		this.MountLemmaList(this.content, snapshot.evidence);
		this.RefreshFloatingPanels();
		if (!snapshot.loadingEvidence && snapshot.evidence !== null
			&& (snapshot.selectedOccurrence !== null || snapshot.lexicalLemma !== null) && activeId !== null)
		{
			const index = this.selectedOccurrenceByTab.get(activeId);
			if (index !== undefined) void this.SelectDialogueOccurrenceAsync(index);
		}
	}

	private SyncTabs(): void
	{
		const tabs = this.store.GetTabs();
		const live = new Set(tabs.map((tab) => tab.id));
		for (const [id] of this.tabPanels)
		{
			if (!live.has(id))
			{
				const panel = this.tabPanels.get(id);
				if (panel !== undefined)
				{
					this.DisposeSelectionLists(panel.Content);
				}
				this.tabs.Remove(id);
				this.tabPanels.delete(id);
				this.selectedOccurrenceByTab.delete(id);
			}
		}
		for (const tab of tabs)
		{
			if (!this.tabPanels.has(tab.id))
			{
				const panel = new WordLookupTabPanel(tab.id, tab.title);
				this.tabPanels.set(tab.id, panel);
				this.tabs.Add(panel, true);
			}
			this.tabs.UpdateTitle(tab.id, tab.title);
		}
		const selected = tabs.find((tab) => tab.selected);
		if (selected !== undefined) this.tabs.Select(selected.id);
	}

	// Patches only linked writing, preserving dictionary, morphology, focus, and occurrence scroll.
	private UpdateVisionReferences(event: ChoraEvents["word.vision-references-changed"]): void
	{
		this.UpdateOccurrenceVisionIndicators(event);
		const tabId = this.store.GetActiveId();
		const index = tabId === null ? undefined : this.selectedOccurrenceByTab.get(tabId);
		const row = index === undefined ? undefined : this.dialogueOccurrenceRows[index];
		if (row !== undefined && row.occurrence.selection.dialogue === event.workId)
		{
			const key = GetTextSelectionIdentity(row.occurrence.selection);
			if (event.selectionKeys === null || event.selectionKeys.includes(key))
			{
				const html = this.RenderVisionReferences(row.occurrence.selection);
				const hosts = [
					this.content.querySelector<HTMLElement>("[data-word-vision-references]"),
					document.querySelector<HTMLElement>('[data-floating-panel="occurrences"]:not([hidden]) [data-word-vision-references]')
				];
				for (const host of hosts)
				{
					if (host !== null && host.innerHTML !== html)
					{
						host.innerHTML = html;
					}
				}
			}
		}
	}

	// Updates derived badges through the shared list rather than rebuilding navigation rows.
	private UpdateOccurrenceVisionIndicators(event: ChoraEvents["word.vision-references-changed"]): void
	{
		for (const row of this.dialogueOccurrenceRows)
		{
			const selection = row.occurrence.selection;
			const identity = GetTextSelectionIdentity(selection);
			if (selection.dialogue === event.workId && (event.selectionKeys === null || event.selectionKeys.includes(identity)))
			{
				const key = this.SelectionKey(selection);
				const indicator = this.RenderOccurrenceVisionIndicator(selection);
				for (const list of this.ActiveOccurrenceLists())
				{
					list.SetBadge(key, indicator);
				}
			}
		}
	}

	// Mounts an independent list instance in each tab or floating navigation slot.
	private MountOccurrenceLists(root: HTMLElement): void
	{
		const hosts = Array.from(root.querySelectorAll<HTMLElement>("[data-word-occurrence-navigation]"));
		const items: ListViewItem[] = [];
		for (let index = 0; index < this.dialogueOccurrenceRows.length; index += 1)
		{
			const row = this.dialogueOccurrenceRows[index]!;
			const id = this.SelectionKey(row.occurrence.selection);
			const detail = this.FormatOccurrenceLocation(row.occurrence);
			const badge = this.RenderOccurrenceVisionIndicator(row.occurrence.selection);
			items.push({ Id: id, Text: row.form, Detail: detail, Language: "grc", BadgeHtml: badge,
				Data: { wordOccurrenceSelect: String(index) } });
		}
		const tabId = this.store.GetActiveId() ?? "detached";
		const index = this.selectedOccurrenceByTab.get(tabId) ?? 0;
		const selection = items[index]?.Id ?? null;
		for (const host of hosts)
		{
			host.replaceChildren();
			const list = new ListViewControl("Occurrences", this.HandleOccurrenceSelectedAsync.bind(this));
			list.SetItems(items);
			list.Select(selection);
			host.append(list.Root);
			this.selectionLists.set(host, list);
		}
	}

	// Maps generic list selection to the exact occurrence workflow.
	private async HandleOccurrenceSelectedAsync(id: string | null): Promise<void>
	{
		if (id !== null)
		{
			const owner = this;
			const index = this.dialogueOccurrenceRows.findIndex(function Matches(row): boolean
			{
				const key = owner.SelectionKey(row.occurrence.selection);
				return key === id;
			});
			if (index >= 0)
			{
				await this.SelectDialogueOccurrenceAsync(index);
			}
		}
	}

	// Reads only lists belonging to the active tab and its visible floating projection.
	private ActiveOccurrenceLists(): readonly ListViewControl[]
	{
		const lists: ListViewControl[] = [];
		for (const [host, list] of this.selectionLists)
		{
			const floating = host.closest<HTMLElement>("[data-floating-panel=occurrences]");
			if (host.hasAttribute("data-word-occurrence-navigation") && (this.content.contains(host) || (floating !== null && !floating.hidden)))
			{
				lists.push(list);
			}
		}
		return lists;
	}

	// Releases child controls before their owning content subtree is replaced or closed.
	private DisposeSelectionLists(root: HTMLElement): void
	{
		for (const [host, list] of this.selectionLists)
		{
			if (root.contains(host))
			{
				list.Dispose();
				this.selectionLists.delete(host);
			}
		}
		this.DisposeSplitViews(root);
	}

	// Uses the same selectable-list behavior for explicit lemma choice.
	private MountLemmaList(root: HTMLElement, evidence: WordEvidenceResult | null): void
	{
		const host = root.querySelector<HTMLElement>("[data-word-lemma-list]");
		if (host !== null && evidence !== null)
		{
			const list = new ListViewControl("Lemma candidates", this.HandleLemmaSelectedAsync.bind(this));
			const items: ListViewItem[] = [];
			for (let index = 0; index < evidence.possibilities.length; index += 1)
			{
				const possibility = evidence.possibilities[index]!;
				items.push({ Id: possibility.lemma, Text: possibility.lemma, Language: "grc", Data: { wordLemmaIndex: String(index) } });
			}
			list.SetItems(items);
			host.append(list.Root);
			this.selectionLists.set(host, list);
		}
	}

	// Keeps the reader's deliberate lemma selection in the owning workflow controller.
	private async HandleLemmaSelectedAsync(lemma: string | null): Promise<void>
	{
		if (lemma !== null)
		{
			await this.controller.SelectLemmaAsync(lemma);
		}
	}

	// Composes evidence surfaces; none of their content renderers inspect host geometry.
	private MountSplitViews(root: HTMLElement): void
	{
		const dictionary = root.querySelector<HTMLElement>(":scope > .word-dictionary-section");
		const occurrences = root.querySelector<HTMLElement>(":scope > .word-occurrences-section");
		if (dictionary !== null && occurrences !== null)
		{
			const host = document.createElement("div");
			host.className = "word-evidence-split";
			this.CreateSplitView(host, "word-evidence", [
				{ Id: "dictionary", Label: "Dictionary", Content: dictionary, Size: LayoutSettings.GetDimension("wordDictionaryPrimaryRatio", 400) },
				{ Id: "occurrences", Label: "Occurrences", Content: occurrences, Size: 600, Fill: true }
			], 700);
			root.replaceChildren(host);
		}
		const details = Array.from(root.querySelectorAll<HTMLElement>(".word-occurrence-master-detail"));
		for (const host of details)
		{
			const list = host.querySelector<HTMLElement>(".word-occurrence-navigation");
			const detail = host.querySelector<HTMLElement>("[data-word-occurrence-detail]");
			if (list !== null && detail !== null)
			{
				host.replaceChildren();
				this.CreateSplitView(host, "word-occurrence-detail", [
					{ Id: "list", Label: "Occurrence list", Content: list, Size: LayoutSettings.GetDimension("wordOccurrenceNavigationRatio", 300) },
					{ Id: "detail", Label: "Occurrence detail", Content: detail, Size: 700, Fill: true }
				], 420);
			}
		}
		const evidenceHosts = Array.from(root.querySelectorAll<HTMLElement>("[data-word-occurrence-evidence]"));
		for (const host of evidenceHosts)
		{
			const excerpt = host.querySelector<HTMLElement>("[data-word-excerpt-pane]");
			const visions = host.querySelector<HTMLElement>("[data-word-vision-references]");
			if (excerpt !== null && visions !== null)
			{
				host.replaceChildren();
				this.CreateSplitView(host, "word-occurrence-evidence", [
					{ Id: "excerpt", Label: "Excerpt", Content: excerpt, Size: 420, Fill: true },
					{ Id: "visions", Label: "Visions", Content: visions, Size: 280 }
				], 500);
			}
		}
	}

	// Shared split composition handles both tab-local and floating projections.
	private CreateSplitView(host: HTMLElement, id: string, panes: readonly SplitPaneOptions[], stackAt: number): void
	{
		function SaveLayout(state: SplitViewState): void
		{
			LayoutSettings.SetSplitView(id, state);
		}
		const view = new SplitViewControl({ Direction: "columns", StackAt: stackAt,
			State: LayoutSettings.GetSplitView(id), Changed: SaveLayout }, host);
		for (const pane of panes)
		{
			view.AddPane(pane);
		}
		this.splitViews.set(host, view);
	}

	// Releases nested observers and gestures before their content subtree is replaced.
	private DisposeSplitViews(root: HTMLElement): void
	{
		const owned: [HTMLElement, SplitViewControl][] = [];
		for (const entry of this.splitViews)
		{
			if (root.contains(entry[0]))
			{
				owned.push(entry);
			}
		}
		for (const [host, view] of owned.reverse())
		{
			view.Dispose();
			this.splitViews.delete(host);
		}
	}

	private Show(): void
	{
		this.store.SetVisible(true);
		this.root.hidden = false;
	}

	private RenderPendingEvidence(_dialogueId: string): string
	{
		let html = `<section class="word-dictionary-section" aria-busy="true">${this.RenderColumnHeading("Dictionary")}<div class="word-dictionary-content"></div></section>`;
		html += `<section class="word-occurrences-section" aria-busy="true">${this.RenderColumnHeading("Occurrences", "<span></span>", "word-occurrences-heading")}</section>`;
		return html;
	}

	private RenderEvidence(
		evidence: WordEvidenceResult,
		selectedLemma: string | null,
		personResearch: WordPersonResearch | null,
		nameNote: string,
		loadingPersonResearch: boolean,
		loadingNameNote: boolean): string
	{
		if (selectedLemma === null)
		{
			let chooser = `<section class="word-lemma-chooser"><div><h3>Choose a lemma for <span lang="grc">${EscapeHtml(evidence.form)}</span></h3>`;
			if (evidence.possibilities.length === 0)
			{
				chooser += "<p>No lemma candidates were returned.</p>";
			}
			else
			{
				chooser += '<div data-word-lemma-list></div>';
			}
			return `${chooser}</div></section>`;
		}

		let html = "";
		const dictionaryEntries = evidence.dictionary.entries.filter((entry) =>
				entry.matchedTerm.normalize("NFC") === selectedLemma.normalize("NFC"));
		const dictionaryTitle = evidence.dictionary.entries.some((entry) => entry.provider.includes("lsj"))
			? "Dictionary (LSJ)"
			: "Dictionary";
		html += `<section class="word-dictionary-section" data-word-section="dictionary">${this.RenderSectionHeading("dictionary", dictionaryTitle)}`;
		html += "<div class=\"word-dictionary-content\">";
		if (dictionaryEntries.length === 0)
		{
			html += "<p class=\"word-dictionary-empty\">No dictionary entry was returned for this lemma.</p>";
		}
		for (const entry of dictionaryEntries)
		{
			html += "<article class=\"word-dictionary-source\">";
			html += this.RenderDictionaryEntry(entry);
			html += "</article>";
		}
		html += "</div>";
		html += this.RenderPersonResearch(
			personResearch, nameNote, loadingPersonResearch, loadingNameNote);
		const lemma = evidence.lemmas.find((candidate) => candidate.lemma === selectedLemma);
		html += this.RenderRelatedLemmas(lemma?.relatedLemmas ?? []);
		html += "</section>";

		html += this.RenderDialogueForms(evidence, selectedLemma);
		return html;
	}

	/** Presents the source and grammatical readings of the reader-selected lemma. */
	private RenderMorphologyDetail(evidence: WordEvidenceResult, selectedLemma: string): string
	{
		let html = `<section class="word-occurrence-morphology"><h4>Morphology</h4><div class="word-analysis-content">`;
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
			const leftBook = left.occurrence.division?.type === "book" ? left.occurrence.division.label : "";
			const rightBook = right.occurrence.division?.type === "book" ? right.occurrence.division.label : "";
			const leftCitation = left.occurrence.citation ?? left.occurrence.selection.start.stephanus;
			const rightCitation = right.occurrence.citation ?? right.occurrence.selection.start.stephanus;
			return leftBook.localeCompare(rightBook, undefined, { numeric: true })
				|| leftCitation.localeCompare(rightCitation, undefined, { numeric: true })
				|| left.occurrence.selection.start.offset - right.occurrence.selection.start.offset;
		});
		if (evidence.selection !== null) this.occurrenceEvidence.set(this.SelectionKey(evidence.selection), evidence);
		this.dialogueOccurrenceRows = rows;
		this.dialogueOccurrenceSelections = rows.map((row) => row.occurrence.selection);
		const title = `Occurrences (${rows.length})`;
		let html = `<section class="word-occurrences-section" data-word-section="occurrences">${this.RenderSectionHeading("occurrences", title, "", "word-occurrences-heading")}`;
		if (rows.length === 0)
		{
			const message = evidence.contract === "platosi.lexical-evidence.v1"
				? evidence.work === null ? "Open a work to see occurrences."
					: evidence.occurrencesStatus === "indexed" ? "No indexed occurrences in this work." : "Occurrence coverage is unavailable for this work."
				: "No mapped matches were supplied. This does not establish that the lemma is absent.";
			html += `<p class="word-occurrence-empty">${message}</p>`;
		}
		else
		{
			const tabId = this.store.GetActiveId() ?? "detached";
			const sourceKey = evidence.selection === null ? null : this.SelectionKey(evidence.selection);
			const sourceIndex = rows.findIndex((row) => this.SelectionKey(row.occurrence.selection) === sourceKey);
			const saved = this.store.GetSnapshot().selectedOccurrence;
			const savedIndex = saved === null ? -1 : rows.findIndex(function MatchesSavedOccurrence(row): boolean
			{
				return GetTextSelectionIdentity(row.occurrence.selection) === GetTextSelectionIdentity(saved);
			});
			const requestedIndex = savedIndex >= 0 ? savedIndex : sourceIndex >= 0 ? sourceIndex : 0;
			const selectedIndex = Math.max(0, Math.min(requestedIndex, rows.length - 1));
			this.selectedOccurrenceByTab.set(tabId, selectedIndex);
			const selected = rows[selectedIndex];
			if (evidence.selection === null && selected !== undefined)
			{
				this.store.SetSelectedOccurrence(selected.occurrence.selection);
			}
			const detail = selected === undefined ? "" : this.RenderOccurrenceDetail(selected, selectedIndex);
			html += `<div class="word-occurrence-master-detail"><nav class="word-occurrence-navigation" data-word-occurrence-navigation aria-label="${EscapeHtml(title)}"></nav><div class="word-occurrence-detail" data-word-occurrence-detail>${detail}</div></div>`;
		}
		html += "</section>";
		return html;
	}

	private RenderOccurrenceVisionIndicator(selection: TextSelection): string
	{
		const count = this.visionReferences.Get(selection).length;
		if (count === 0) return "";
		const noun = count === 1 ? "Vision" : "Visions";
		const title = `View ${count} ${noun} citing this occurrence`;
		return `<span class="word-occurrence-reference-indicator" data-word-vision-indicator data-list-action title="${EscapeHtml(title)}" role="img" aria-label="${EscapeHtml(title)}">${DocumentIcon}</span>`;
	}

	private RenderOccurrenceDetail(
		row: { readonly form: string; readonly occurrence: WordOccurrence },
		index: number,
		morphologyState: "ready" | "loading" | "error" = "ready"): string
	{
		const excerpt = this.RenderOccurrenceExcerpt(row, index, morphologyState);
		const visions = this.RenderVisionReferences(row.occurrence.selection);
		const detail = `<div class="word-occurrence-evidence" data-word-occurrence-evidence><section class="word-occurrence-excerpt" data-word-excerpt-pane>${this.RenderColumnHeading("Excerpt")}<div class="word-occurrence-excerpt-body" data-word-excerpt-body>${excerpt}</div></section><section class="word-occurrence-vision-pane" data-word-vision-references>${visions}</section></div>`;
		return detail;
	}

	// Passage and morphology update independently from the persisted excerpt/Visions split.
	private RenderOccurrenceExcerpt(
		row: { readonly form: string; readonly occurrence: WordOccurrence },
		index: number,
		morphologyState: "ready" | "loading" | "error"): string
	{
		const passage = this.HighlightOccurrence(row.occurrence, row.form, index);
		const snapshot = this.store.GetSnapshot();
		const evidence = this.occurrenceEvidence.get(this.SelectionKey(row.occurrence.selection));
		let morphology = "";
		if (snapshot.selectedLemma !== null)
		{
			if (morphologyState === "loading")
			{
				morphology = this.RenderMorphologyStatus("Loading morphology…", true);
			}
			else if (morphologyState === "error" || evidence === null)
			{
				morphology = this.RenderMorphologyStatus("Morphology is unavailable for this occurrence.", false);
			}
			else if (evidence !== undefined)
			{
				morphology = this.RenderMorphologyDetail(evidence, snapshot.selectedLemma);
			}
		}
		return `<div class="word-occurrence-passage" lang="grc">${passage}</div>${morphology}`;
	}

	private RenderMorphologyStatus(message: string, loading: boolean): string
	{
		const busy = loading ? " aria-busy=\"true\"" : "";
		return `<section class="word-occurrence-morphology"${busy}><h4>Morphology</h4><div class="word-analysis-content"><p class="word-occurrence-morphology-status">${EscapeHtml(message)}</p></div></section>`;
	}

	private FormatOccurrenceLocation(occurrence: WordOccurrence): string
	{
		const citation = occurrence.citation ?? occurrence.selection.start.stephanus;
		return occurrence.division?.type === "book"
			? `Book ${occurrence.division.label} ${citation}`
			: citation;
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

	// Renders the selected occurrence's links while retaining usable results during reconciliation.
	private RenderVisionReferences(selection: TextSelection): string
	{
		const state = this.visionReferences.GetState(selection.dialogue);
		const references = this.visionReferences.Get(selection);
		let html = this.RenderColumnHeading(`Visions (${references.length})`);
		if (references.length > 0)
		{
			html += '<div class="word-occurrence-visions"><ul>';
			for (const reference of references)
			{
				const excerpt = reference.excerpt === undefined ? "" : `<span class="word-vision-excerpt">${EscapeHtml(reference.excerpt)}</span>`;
				html += `<li><button type="button" data-word-vision-id="${EscapeHtml(reference.visionId)}" data-word-placement-id="${EscapeHtml(reference.placementId)}"><span class="word-vision-title">${EscapeHtml(reference.visionTitle)}</span>${excerpt}</button></li>`;
			}
			html += "</ul></div>";
		}
		if (state === "loading")
		{
			html += "<p class=\"word-occurrence-visions-status\">Loading linked Visions…</p>";
		}
		else if (state === "error")
		{
			html += "<p class=\"word-occurrence-visions-status\">Linked Visions are unavailable.</p>";
		}
		return html;
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

	private HighlightOccurrence(occurrence: WordOccurrence, form: string, occurrenceIndex?: number): string
	{
		const start = occurrence.selection.start.offset;
		const end = occurrence.selection.end.offset;
		const selected = occurrence.passage.slice(start, end);
		if (occurrence.selection.start.stephanus === occurrence.selection.end.stephanus
			&& selected.normalize("NFC") === form.normalize("NFC"))
		{
			return `${EscapeHtml(occurrence.passage.slice(0, start))}${this.RenderOccurrenceForm(selected, occurrenceIndex)}${EscapeHtml(occurrence.passage.slice(end))}`;
		}
		const fallback = occurrence.passage.indexOf(form);
		if (fallback < 0) return EscapeHtml(occurrence.passage);
		return `${EscapeHtml(occurrence.passage.slice(0, fallback))}${this.RenderOccurrenceForm(form, occurrenceIndex)}${EscapeHtml(occurrence.passage.slice(fallback + form.length))}`;
	}

	private RenderOccurrenceForm(form: string, occurrenceIndex?: number): string
	{
		if (occurrenceIndex === undefined)
			return `<strong class="word-occurrence-form" lang="grc">${EscapeHtml(form)}</strong>`;
		return `<button type="button" class="word-occurrence-form" data-word-occurrence-index="${occurrenceIndex}" title="Open this section" lang="grc">${EscapeHtml(form)}</button>`;
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

	private SelectionKey(selection: TextSelection): string
	{
		return [
			selection.dialogue,
			selection.text_version,
			selection.start.stephanus,
			selection.start.offset,
			selection.end.stephanus,
			selection.end.offset
		].join("|");
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
		this.DisposeSelectionLists(panel.Content);
		panel.SetBody(clone);
		this.MountSplitViews(panel.Content);
		this.MountOccurrenceLists(panel.Content);
		return true;
	}

	/** Routes delegated lookup actions. */
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const floating = target?.closest<HTMLElement>("[data-word-float]");
		const jump = target?.closest<HTMLElement>("[data-word-jump]");
		const occurrenceVision = target?.closest<HTMLElement>("[data-word-vision-indicator]");
		const occurrenceSelection = target?.closest<HTMLElement>("[data-word-occurrence-select]");
		const occurrence = target?.closest<HTMLElement>("[data-word-occurrence-index]");
		const vision = target?.closest<HTMLElement>("[data-word-vision-id]");
		const source = target?.closest<HTMLElement>("[data-person-source]");
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
			this.store.SetVisible(false);
			this.root.hidden = true;
			void this.events.PublishAsync("word.exploration-visibility-changed", { visible: false });
		}
		else if (source !== null && source !== undefined)
		{
			event.preventDefault();
			const url = source.dataset.personSource;
			if (url !== undefined) void this.controller.OpenExternalSourceAsync(url);
		}
		else if (vision !== null && vision !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			const visionId = vision.dataset.wordVisionId;
			const placementId = vision.dataset.wordPlacementId;
			if (visionId !== undefined && placementId !== undefined)
			{
				void this.events.PublishAsync("vision.reference-open-requested", { visionId, placementId });
			}
		}
		else if (occurrenceVision !== null && occurrenceVision !== undefined
			&& occurrenceSelection !== null && occurrenceSelection !== undefined)
		{
			event.preventDefault();
			const index = Number(occurrenceSelection.dataset.wordOccurrenceSelect);
			event.stopPropagation();
			void this.SelectDialogueOccurrenceAsync(index, true);
		}
		else if (occurrence !== null && occurrence !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			const index = Number(occurrence.dataset.wordOccurrenceIndex);
			const selection = this.dialogueOccurrenceSelections[index];
			if (selection !== undefined) void this.controller.JumpAsync(selection);
		}
		else if (jump !== null && jump !== undefined)
		{
			const index = Number(jump.dataset.wordJump);
			const occurrence = this.store.GetSnapshot().result?.occurrences[index];
			if (occurrence !== undefined) void this.controller.JumpAsync(occurrence.selection);
		}
	}

	private async SelectDialogueOccurrenceAsync(index: number, revealVisions = false): Promise<void>
	{
		const row = this.dialogueOccurrenceRows[index];
		const activeId = this.store.GetActiveId();
		if (row === undefined || activeId === null) return;
		this.controller.SelectOccurrence(row.occurrence.selection);
		this.selectedOccurrenceByTab.set(activeId, index);
		const key = this.SelectionKey(row.occurrence.selection);
		const hasEvidence = this.occurrenceEvidence.has(key);
		this.UpdateDialogueOccurrence(row, index, hasEvidence
			? this.occurrenceEvidence.get(key) === null ? "error" : "ready"
			: "loading");
		if (revealVisions) this.RevealOccurrenceVisions();
		if (hasEvidence) return;
		if (this.pendingOccurrences.has(key)) return;
		this.pendingOccurrences.add(key);
		const evidence = await this.controller.GetOccurrenceEvidenceAsync(row.occurrence.selection);
		this.pendingOccurrences.delete(key);
		this.occurrenceEvidence.set(key, evidence);
		if (this.disposed || this.store.GetActiveId() !== activeId || this.selectedOccurrenceByTab.get(activeId) !== index) return;
		this.UpdateDialogueOccurrence(row, index, evidence === null ? "error" : "ready");
		if (revealVisions) this.RevealOccurrenceVisions();
	}

	private RevealOccurrenceVisions(): void
	{
		const visions = this.content.querySelector<HTMLElement>(".word-occurrence-visions");
		visions?.scrollIntoView?.({ block: "nearest" });
	}

	private UpdateDialogueOccurrence(
		row: { readonly form: string; readonly occurrence: WordOccurrence },
		index: number,
		morphologyState: "ready" | "loading" | "error"): void
	{
		const key = this.SelectionKey(row.occurrence.selection);
		for (const list of this.ActiveOccurrenceLists())
		{
			list.Select(key);
		}
		const sections = [
			this.content.querySelector<HTMLElement>('[data-word-section="occurrences"]'),
			document.querySelector<HTMLElement>('[data-floating-panel="occurrences"]:not([hidden]) [data-word-section="occurrences"]')
		].filter((section): section is HTMLElement => section !== null);
		for (const section of sections)
		{
			const excerpt = section.querySelector<HTMLElement>("[data-word-excerpt-body]");
			if (excerpt !== null) excerpt.innerHTML = this.RenderOccurrenceExcerpt(row, index, morphologyState);
			const visions = section.querySelector<HTMLElement>("[data-word-vision-references]");
			if (visions !== null) visions.innerHTML = this.RenderVisionReferences(row.occurrence.selection);
		}
	}

	private HandleInput(event: Event): void
	{
		const target = event.target;
		if (!(target instanceof HTMLTextAreaElement)) return;
		if (target.matches("[data-word-name-note]"))
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
}
