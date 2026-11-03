// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextDocument, type TextDocumentSnapshot } from "../../src/shared/text/TextDocument.js";
import type { WordSearchResult } from "../../src/shared/library/WordExplorationTypes.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { WordExplorationStore } from "../../src/renderer/library/words/WordExplorationStore.js";
import { WordExplorationGateway } from "../../src/renderer/library/words/WordExplorationGateway.js";
import { WordExplorationController } from "../../src/renderer/library/words/WordExplorationController.js";
import { WordExplorationPanel } from "../../src/renderer/library/words/WordExplorationPanel.js";

afterEach(function Cleanup(): void
{
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("WordExplorationPanel", function WordExplorationPanelTests()
{
	it("opens selected text and renders organized PlatoSI evidence", async function ExploresWordAsync(): Promise<void>
	{
		const snapshot: TextDocumentSnapshot = {
			id: "republic",
			textVersion: `sha256:${"0".repeat(64)}`,
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
			segments: [{ key: "first", citation: { system: "stephanus", value: "327a" }, text: "κατέβην χθὲς" }]
		};
		const text = TextDocument.FromSnapshot(snapshot);
		const start = { stephanus: "first", offset: 0 };
		const end = { stephanus: "first", offset: 7 };
		const selection = text.CreateSelection(start, end);
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.Open(text, null);
		const store = new WordExplorationStore();
		const gateway = new WordExplorationGateway();
		const occurrence = {
			selection,
			citation: "327a",
			division: { type: "book", label: "1" },
			passage: "κατέβην χθὲς"
		};
		const searchResult: WordSearchResult = { form: "κατέβην", occurrences: [occurrence], total: 1 };
		vi.spyOn(gateway, "SearchAsync").mockResolvedValue(searchResult);
		const evidence = vi.spyOn(gateway, "GetEvidenceAsync");
		vi.spyOn(gateway, "GetObservationAsync").mockResolvedValue({
			dialogue: "republic",
			textVersion: snapshot.textVersion,
			lemma: "καταβαίνω",
			text: "Opening descent."
		});
		const saveObservation = vi.spyOn(gateway, "SaveObservationAsync").mockImplementation(
			async (observation) => observation);
		const personResearch = vi.spyOn(gateway, "GetPersonResearchAsync").mockResolvedValue({
			contract: "platosi.person-research.v1",
			status: "ok",
			lemma: "κατάβασις",
			classification: {
				properNameCandidate: true,
				basis: "Dilemma returned a capitalized lemma."
			},
			roots: [],
			summary: {
				person: "A grounded identity summary. [S1]",
				nameMeaning: "The available sources do not establish a name meaning.",
				relationships: ["A sourced relationship. [S1]"]
			},
			sources: [{
				id: "S1",
				kind: "wikidata",
				title: "Research source",
				url: "https://www.wikidata.org/wiki/Q1",
				excerpt: "Evidence",
				provider: "Wikidata",
				cached: false
			}],
			model: { model: "qwen3.5:9b" },
			warnings: []
		});
		const openSource = vi.spyOn(gateway, "OpenExternalSourceAsync").mockResolvedValue();
		const revealSelection = vi.fn().mockResolvedValue(undefined);
		const reader = { RevealSelectionAsync: revealSelection };
		evidence.mockResolvedValue({
			contract: "platosi.dialogue-lexicon.v1",
			selection,
			form: "κατέβην",
			context: [{ stephanus: "327a", text: "κατέβην χθὲς" }],
			possibilities: [
				{
					lemma: "καταβαίνω",
					candidates: [{
						provider: "dilemma", providerVersion: "1", method: "lookup",
						classification: "lookup_candidate", language: "grc", proper: false,
						rank: 1, via: "exact", citation: "unchanged", tag: "",
						settings: { resolve_articles: false },
						source: { attribution: "Dilemma", revision: "test", repository: null }
					}]
				},
				{
					lemma: "κατάβασις",
					candidates: [{
						provider: "dilemma", providerVersion: "1", method: "lookup",
						classification: "lookup_candidate", language: "grc", proper: true,
						rank: 2, via: "exact", citation: "unchanged", tag: "",
						settings: { resolve_articles: false },
						source: { attribution: "Dilemma", revision: "test", repository: null }
					}]
				}
			],
			lemmas: [{
				lemma: "καταβαίνω",
				candidates: [{
					provider: "dilemma", providerVersion: "1", method: "lookup",
					classification: "lookup_candidate", language: "grc", proper: false,
					rank: 1, via: "exact", citation: "unchanged", tag: "",
					settings: { resolve_articles: false },
					source: { attribution: "Dilemma", revision: "test", repository: null }
				}],
				forms: [{
					form: "κατέβην",
					occurrences: [occurrence],
					total: 1,
					evidence: [{ provider: "dilemma", classification: "direct_lookup" }]
				}],
				relatedLemmas: [{
					lemma: "βάσις",
					relationType: "derived_noun",
					direction: "directed",
					presentInDialogue: false,
					total: 0,
					forms: [],
					evidence: [{ provider: "lsj-logeion", classification: "explicit_dictionary_markup" }]
				}]
			},
			{
				lemma: "κατάβασις",
				candidates: [{
					provider: "dilemma", providerVersion: "1", method: "lookup",
					classification: "lookup_candidate", language: "grc", proper: false,
					rank: 2, via: "exact", citation: "unchanged", tag: "",
					settings: { resolve_articles: false },
					source: { attribution: "Dilemma", revision: "test", repository: null }
				}],
				forms: [],
				relatedLemmas: []
			}],
			dictionary: {
				status: "ok",
				entries: [{
					provider: "lsj-logeion", providerVersion: "1", headword: "καταβαίνω",
					matchedTerm: "καταβαίνω",
					entryId: "entry", plainText: "καταβαίνω, Dor. κᾰβαίνω go down",
					entryXml: "<div2><head>καταβαίνω</head>, <gramGrp><gram>Dor.</gram></gramGrp> <orth>κᾰβαίνω</orth><sense n=\"1\"><i>go down</i></sense></div2>",
					source: { attribution: "LSJ", revision: "test", repository: null },
					license: { status: "test" }
				}],
				possiblyTruncated: false
			},
			morphology: {
				status: "ok",
				provider: { attribution: "Dilemma", revision: "test", repository: null },
				normalization: { original: "κατέβην" },
				spellingSuggestions: ["κατέβην"],
				formAttestation: {
					form: "κατέβην", attested: true, total: 1, works: 1,
					sourceCounts: {}, byGenre: { philosophy: 1 }, byCentury: { "-5": 1 },
					byDialect: { Attic: 1 }, dominantPartOfSpeech: "verb", citations: []
				},
				lemmas: [{
					lemma: "καταβαίνω",
					attestation: {
						form: null, attested: null, total: 2, works: null,
						sourceCounts: {}, byGenre: {}, byCentury: {}, byDialect: {},
						dominantPartOfSpeech: "verb", citations: []
					},
					paradigm: {
						partOfSpeech: "verb",
						forms: [{ slot: "active_aorist_indicative_1sg", form: "κατέβην", source: "morpheus" }]
					}
				}],
				artifacts: { file_count: 1 }
			},
			warnings: ["fixture notice"],
			limitations: "Direct mappings and explicit relations only."
		});
		const controller = new WordExplorationController(events, errors, library, reader, store, gateway);
		const root = document.createElement("section");
		document.body.append(root);
		const panel = new WordExplorationPanel(root, events, store, controller);
		expect(root.hidden).toBe(true);
		const paneResize = root.querySelector<HTMLElement>("[data-resize-pane=\"word\"]");
		expect(paneResize).not.toBeNull();
		paneResize?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
		expect(root.style.height).toBe("244px");
		expect(window.localStorage.getItem("chora:layout-settings")).toContain("\"wordPaneHeight\":244");
		await events.PublishAsync("word.exploration-requested", { selection });
		expect(root.hidden).toBe(false);
		expect(root.querySelector("[data-word-title]")?.textContent).toBe("Word lookup: κατέβην");
		expect(root.querySelector(".word-evidence-target")).toBeNull();
		expect(evidence).toHaveBeenCalledWith(selection);
		expect(personResearch).not.toHaveBeenCalled();
		expect(gateway.SearchAsync).not.toHaveBeenCalled();
		expect(root.textContent).toContain("Lemmas");
		expect(root.querySelector<HTMLElement>("[data-word-content]")?.style.gridTemplateColumns)
			.toContain("max-content");
		expect(root.textContent).toContain("καταβαίνω");
		const lemmaTabs = root.querySelectorAll<HTMLButtonElement>("[data-word-lemma-index]");
		expect(lemmaTabs).toHaveLength(2);
		expect(lemmaTabs[0]?.getAttribute("aria-selected")).toBe("true");
		expect(lemmaTabs[1]?.getAttribute("aria-selected")).toBe("false");
		lemmaTabs[1]?.click();
		await vi.waitFor(function SecondLemmaSelected(): void
		{
			expect(root.querySelectorAll<HTMLButtonElement>("[data-word-lemma-index]")[1]
				?.getAttribute("aria-selected")).toBe("true");
			expect(personResearch).toHaveBeenCalledWith(selection, "κατάβασις");
			expect(root.textContent).toContain("A grounded identity summary.");
		});
		root.querySelector<HTMLButtonElement>("[data-person-source]")?.click();
		await vi.waitFor(function SourceOpened(): void
		{
			expect(openSource).toHaveBeenCalledWith("https://www.wikidata.org/wiki/Q1");
		});
		expect(root.querySelector(".word-dictionary-section")).toBeNull();
		expect(root.querySelector(".word-person-section")).not.toBeNull();
		root.querySelectorAll<HTMLButtonElement>("[data-word-lemma-index]")[0]?.click();
		await vi.waitFor(function FirstLemmaReselected(): void
		{
			expect(root.querySelectorAll<HTMLButtonElement>("[data-word-lemma-index]")[0]
				?.getAttribute("aria-selected")).toBe("true");
		});
		expect(root.textContent).toContain("go down");
		expect(root.querySelector(".word-dictionary-entry")?.textContent).toContain("go down");
		expect(root.querySelector(".word-dictionary-entry")?.textContent?.trim().startsWith("καταβαίνω"))
			.toBe(false);
		const dictionary = root.querySelector<HTMLElement>(".word-dictionary-content");
		expect(dictionary).not.toBeNull();
		expect(root.textContent).toContain("Occurrences in the Republic");
		const occurrences = root.querySelector<HTMLDetailsElement>(".word-occurrences-section > details");
		expect(occurrences?.open).toBe(true);
		expect(root.querySelector(".word-occurrences-heading > span")?.textContent).toBe("1");
		occurrences?.querySelector<HTMLElement>(":scope > summary")?.click();
		expect(occurrences?.open).toBe(false);
		occurrences?.querySelector<HTMLElement>(":scope > summary")?.click();
		expect(root.textContent).toContain("Book I");
		expect(root.textContent).toContain("Related lemmas");
		expect(root.textContent).toContain("βάσις");
		expect(root.textContent).toContain("not in this dialogue");
		expect(root.textContent).not.toContain("Occurrences in this dialogue");
		expect(root.textContent).not.toContain("Selected-form attestations");
		expect(root.textContent).not.toContain("Lemma usage");
		expect(root.textContent).not.toContain("Provider notices");
		expect(root.textContent).not.toContain("Sources and artifact provenance");
		const highlighted = root.querySelector<HTMLElement>(".word-occurrence-form");
		expect(highlighted?.textContent).toBe("κατέβην");
		const occurrenceRow = root.querySelector<HTMLDetailsElement>(".word-occurrence-row");
		expect(occurrenceRow?.open).toBe(false);
		expect(occurrenceRow?.querySelector("summary")?.textContent).toBe("Book I327aκατέβην");
		expect(occurrenceRow?.querySelector("summary")?.textContent).not.toContain("χθὲς");
		occurrenceRow?.querySelector<HTMLButtonElement>("[data-word-occurrence-index]")?.click();
		await vi.waitFor(function OccurrenceRevealed(): void
		{
			expect(revealSelection).toHaveBeenCalledWith(selection, "word");
		});
		expect(occurrenceRow?.open).toBe(false);
		occurrenceRow?.querySelector("summary")?.click();
		expect(occurrenceRow?.open).toBe(true);
		await vi.waitFor(function ObservationReloaded(): void
		{
			expect(root.querySelector<HTMLTextAreaElement>("[data-word-observation]")?.value)
				.toBe("Opening descent.");
		});
		const observation = root.querySelector<HTMLTextAreaElement>("[data-word-observation]");
		if (observation !== null)
		{
			observation.value = "A spatial and temporal descent.";
			observation.dispatchEvent(new Event("input", { bubbles: true }));
		}
		await vi.waitFor(function ObservationSaved(): void
		{
			expect(saveObservation).toHaveBeenCalledWith({
				dialogue: "republic",
				textVersion: snapshot.textVersion,
				lemma: "καταβαίνω",
				text: "A spatial and temporal descent."
			});
		}, { timeout: 1000 });
		root.querySelector<HTMLButtonElement>("[data-word-close]")?.click();
		expect(root.hidden).toBe(true);
		panel.Dispose();
		controller.Dispose();
	});
});
