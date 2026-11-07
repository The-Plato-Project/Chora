// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
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
	it("keeps all name research states within the panel margins", function KeepsNameResearchWithinMargins(): void
	{
		const css = readFileSync("src/renderer/styles/base.css", "utf8");
		const rule = css.match(/\.word-person-content\s*\{(?<declarations>[^}]*)\}/s);

		expect(rule?.groups?.declarations).toMatch(/box-sizing:\s*border-box;/);
		expect(rule?.groups?.declarations).toMatch(/width:\s*100%;/);
		expect(rule?.groups?.declarations).toMatch(/padding:\s*0\.55rem 1rem 1rem;/);
		expect(rule?.groups?.declarations).not.toMatch(/max-width:/);
	});

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
		vi.spyOn(gateway, "GetNameNoteAsync").mockResolvedValue({
			dialogue: "republic",
			lemma: "κατάβασις",
			text: "The port matters to this dialogue."
		});
		const saveNameNote = vi.spyOn(gateway, "SaveNameNoteAsync").mockImplementation(
			async (note) => note);
		const researchSource = {
			id: "S2", kind: "plato_prosopography", title: "Polemarchus",
			url: "https://humanisticadigitalia.eu/GreekTexts/Plato/#p-polemarchus",
			excerpt: "Polemarchus was the eldest son of Cephalus.",
			provider: "Platonis Humanistica Digitalia", cached: false,
			relevance: "plato_dialogue" as const
		};
		const personResearch = vi.spyOn(gateway, "GetPersonResearchAsync").mockResolvedValue({
			contract: "platosi.person-research.v3",
			status: "ok",
			lemma: "κατάβασις",
			classification: {
				properNameCandidate: true,
				basis: "Fixture morphology returned a capitalized lemma."
			},
			overview: "Polemarchus was the eldest son of Cephalus. [S2]",
			sources: [researchSource],
			candidates: [{
				id: "reference:polemarchus",
				label: "Polemarchus",
				sources: [researchSource]
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
			coverage: {
				analysisProviders: ["fixture-morphology", "morpheus"],
				formInventoryProviders: ["fixture-morphology", "morpheus"],
				analysisOnlyProviders: [],
				morphologyIndexProviders: ["morpheus"],
				morphologyIndexes: [{ provider: "morpheus", state: "ready", checkedForms: 10,
					totalForms: 10, analyzedForms: 9, unresolvedForms: 1, failedForms: 0,
					pendingForms: 0, wholeDialogueComplete: true, contextReviewed: false }]
			},
			possibilities: [
				{
					lemma: "καταβαίνω",
					candidates: [{
						provider: "fixture-morphology", providerVersion: "1", method: "lookup",
						classification: "lookup_candidate", language: "grc", proper: false,
						rank: 1, via: "exact", citation: "unchanged", tag: "",
						settings: { resolve_articles: false },
						source: { attribution: "Fixture morphology", revision: "test", repository: null }
					}, {
						provider: "morpheus", providerVersion: "1", method: "morpheus",
						classification: "morphological_analysis_candidate", language: "grc", proper: false,
						rank: null, via: null, citation: null, tag: "",
						headword: "καταβαίνω", homograph: null,
						features: { part_of_speech: "verb", tense: "aorist", voice: "active",
							mood: "indicative", person: "1st", number: "singular" },
						settings: { strict_case: true },
						source: { attribution: "Morpheus", revision: null, repository: null }
					}, {
						provider: "morpheus", providerVersion: "1", method: "morpheus",
						classification: "morphological_analysis_candidate", language: "grc", proper: false,
						rank: null, via: null, citation: null, tag: "",
						headword: "καταβαίνω", homograph: null,
						features: { part_of_speech: "verb", tense: "aorist", voice: "active",
							mood: "indicative", person: "3rd", number: "plural", dialect: "epic Doric Aeolic" },
						settings: { strict_case: true },
						source: { attribution: "Morpheus", revision: null, repository: null }
					}]
				},
				{
					lemma: "κατάβασις",
					candidates: [{
						provider: "fixture-morphology", providerVersion: "1", method: "lookup",
						classification: "lookup_candidate", language: "grc", proper: true,
						rank: 2, via: "exact", citation: "unchanged", tag: "",
						settings: { resolve_articles: false },
						source: { attribution: "Fixture morphology", revision: "test", repository: null }
					}]
				}
			],
			lemmas: [{
				lemma: "καταβαίνω",
				candidates: [{
					provider: "fixture-morphology", providerVersion: "1", method: "lookup",
					classification: "lookup_candidate", language: "grc", proper: false,
					rank: 1, via: "exact", citation: "unchanged", tag: "",
					settings: { resolve_articles: false },
					source: { attribution: "Fixture morphology", revision: "test", repository: null }
				}],
				forms: [{
					form: "κατέβην",
					occurrences: [occurrence],
					total: 1,
					evidence: [{ provider: "fixture-morphology", classification: "direct_lookup" }]
				}],
				relatedLemmas: [{
					lemma: "βάσις",
					relationType: "derived_noun",
					direction: "directed",
					presentInDialogue: false,
					total: 0,
					forms: [],
					evidence: [{ provider: "lsj-logeion", classification: "explicit_dictionary_markup" }],
					dictionary: {
						status: "ok", possiblyTruncated: false,
						entries: [{
							provider: "lsj-logeion", providerVersion: "1", headword: "βάσις", matchedTerm: "βάσις",
							entryId: "basis", plainText: "βάσις step, pace",
							entryXml: "<div2><head>βάσις</head><sense><i>step, pace</i></sense></div2>",
							source: { attribution: "LSJ", revision: "test", repository: null }, license: { status: "test" }
						}]
					}
				}]
			},
			{
				lemma: "κατάβασις",
				candidates: [{
					provider: "fixture-morphology", providerVersion: "1", method: "lookup",
					classification: "lookup_candidate", language: "grc", proper: false,
					rank: 2, via: "exact", citation: "unchanged", tag: "",
					settings: { resolve_articles: false },
					source: { attribution: "Fixture morphology", revision: "test", repository: null }
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
				provider: { attribution: "Fixture morphology", revision: "test", repository: null },
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
		expect(root.querySelector("[data-word-close]")?.textContent).toBe("");
		expect(root.querySelector("[data-word-close] svg")).not.toBeNull();
		expect(root.querySelector("[data-word-close]")?.getAttribute("aria-label")).toBe("Close word lookup");
		expect(root.querySelector("[data-resize-pane=\"word\"]")?.classList.contains("row-resize-handle"))
			.toBe(true);
		expect(root.querySelector(".word-evidence-target")).toBeNull();
		expect(evidence).toHaveBeenCalledWith(selection);
		expect(personResearch).not.toHaveBeenCalled();
		expect(gateway.SearchAsync).not.toHaveBeenCalled();
		expect(root.textContent).toContain("Lemmas");
		expect(root.querySelector<HTMLElement>("[data-word-content]")?.style.gridTemplateColumns)
			.toContain("max-content");
		expect(root.querySelectorAll(".word-column-resize-handle:not(.column-resize-handle)")).toHaveLength(0);
		expect(root.querySelectorAll(".word-column-resize-handle.column-resize-handle").length)
			.toBeGreaterThan(0);
		for (const textarea of root.querySelectorAll("textarea"))
		{
			expect(textarea.classList.contains("multiline-input")).toBe(true);
		}
		expect(root.textContent).toContain("καταβαίνω");
		expect(root.querySelectorAll(".word-analysis-reading")).toHaveLength(3);
		expect(root.querySelector(".word-analysis-reading h4")).toBeNull();
		expect(root.querySelector(".word-analysis-content")?.textContent).toContain("1st person · singular");
		expect(root.querySelector(".word-analysis-content")?.textContent).toContain("3rd person · plural");
		expect(root.querySelector(".word-analysis-context")?.textContent)
			.toBe("Possible readings of κατέβην as καταβαίνω.");
		expect(root.querySelector(".word-analysis-disagreement")).toBeNull();
		expect(root.querySelector(".word-analysis-section > .word-column-heading > h3")?.textContent)
			.toBe("Morphology");
		const columnSections = root.querySelectorAll<HTMLElement>("[data-word-content] > section");
		expect(columnSections.length).toBeGreaterThan(0);
		for (const section of columnSections)
		{
			expect(section.querySelector(":scope > .word-column-heading")).not.toBeNull();
		}
		expect(root.querySelector(".word-analysis-section [data-word-float]")).toBeNull();
		expect(root.querySelector(".word-lemma-section [data-word-float]")).toBeNull();
		expect(root.textContent).not.toContain("These are possible readings of the selected word");
		expect(root.querySelector(".word-lemma-tabs")?.getAttribute("aria-orientation")).toBe("vertical");
		const css = readFileSync("src/renderer/styles/base.css", "utf8");
		expect(css).toMatch(/\.word-lemma-tabs\.tab-list\s*\{[^}]*flex-direction:\s*column;/s);
		expect(css).toMatch(/\.word-exploration\s*\{[^}]*padding:\s*0;/s);
		expect(css).toMatch(/\.floating-panel-close svg\s*\{[^}]*stroke:\s*currentColor;/s);
		expect(css).toMatch(/\.column-resize-handle\s*\{[^}]*border-left:\s*1px solid var\(--panel-border\);/s);
		expect(css).toMatch(/\.multiline-input,[^{]*\.dream-field textarea\s*\{[^}]*border:\s*1px solid var\(--panel-border\);/s);
		expect(root.querySelector(".word-analysis-notices")?.textContent).toContain("fixture notice");
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
			expect(root.querySelectorAll(".word-name-overview")).toHaveLength(1);
			expect(root.querySelector(".word-occurrences-heading > span")?.textContent).toBe("Not established");
			expect(root.querySelector(".word-occurrence-empty")?.textContent)
				.toContain("does not establish that the lemma is absent");
			expect(root.querySelector(".word-name-overview")?.textContent)
				.toBe("Polemarchus was the eldest son of Cephalus. [S2]");
			expect(root.textContent).toContain("Name research");
			expect(root.querySelectorAll("[data-person-source]")).toHaveLength(1);
			expect(root.querySelector<HTMLTextAreaElement>("[data-word-name-note]")?.value)
				.toBe("The port matters to this dialogue.");
		});
		const overview = root.querySelector(".word-name-overview");
		expect(overview?.nextElementSibling?.classList.contains("word-person-sources")).toBe(true);
		expect(root.textContent).not.toContain("Show evidence");
		expect(root.textContent).not.toContain("Research details");
		expect(root.querySelector(".word-person-issues")).toBeNull();
		const nameNote = root.querySelector<HTMLTextAreaElement>("[data-word-name-note]");
		if (nameNote !== null)
		{
			nameNote.value = "The harbor frames the dialogue's opening.";
			nameNote.dispatchEvent(new Event("input", { bubbles: true }));
		}
		await vi.waitFor(function NameNoteSaved(): void
		{
			expect(saveNameNote).toHaveBeenCalledWith({
				dialogue: "republic",
				lemma: "κατάβασις",
				text: "The harbor frames the dialogue's opening."
			});
		}, { timeout: 1000 });
		root.querySelector<HTMLAnchorElement>("[data-person-source]")?.click();
		await vi.waitFor(function SourceOpened(): void
		{
			expect(openSource).toHaveBeenCalledWith(
				"https://humanisticadigitalia.eu/GreekTexts/Plato/#p-polemarchus");
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
			.toBe(true);
		const dictionary = root.querySelector<HTMLElement>(".word-dictionary-content");
		expect(dictionary).not.toBeNull();
		expect(root.textContent).toContain("Occurrences in the Republic");
		const occurrenceHeading = root.querySelector<HTMLElement>(".word-occurrences-heading");
		expect(occurrenceHeading?.tagName).toBe("HEADER");
		expect(root.querySelector(".word-occurrences-section > details:not(.word-occurrence-row)")).toBeNull();
		expect(root.querySelector(".word-occurrences-heading > span")?.textContent).toBe("1 mapped");
		expect(root.querySelector(".word-occurrence-coverage")?.textContent).toContain("Coverage");
		expect(root.querySelector(".word-occurrence-coverage")?.textContent)
			.toContain("PlatoSI indexed all 10 dialogue forms with Morpheus");
		occurrenceHeading?.click();
		expect(root.textContent).toContain("Book I");
		expect(root.textContent).toContain("Related lemmas");
		expect(root.textContent).toContain("βάσις");
		expect(root.querySelector(".word-related-definition")?.textContent).toContain("LSJ");
		expect(root.querySelector(".word-related-definition")?.textContent).toContain("step, pace");
		const relatedRow = root.querySelector<HTMLDetailsElement>(".word-related-row");
		expect(relatedRow?.open).toBe(false);
		relatedRow?.querySelector("summary")?.click();
		expect(relatedRow?.open).toBe(true);
		const relatedDictionary = relatedRow?.querySelector<HTMLDetailsElement>(".word-related-dictionary");
		expect(relatedDictionary?.open).toBe(false);
		expect(root.textContent).toContain("No mapped matches");
		expect(root.textContent).not.toContain("Occurrences in this dialogue");
		expect(root.textContent).not.toContain("Selected-form attestations");
		expect(root.textContent).not.toContain("Lemma usage");
		expect(root.textContent).not.toContain("Provider notices");
		expect(root.textContent).not.toContain("Sources and artifact provenance");
		expect(Array.from(root.querySelectorAll("h3"), (heading) => heading.textContent))
			.toContain("Notes");
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
		const floatButtons = root.querySelectorAll<HTMLButtonElement>("[data-word-float]");
		expect(Array.from(floatButtons, (button) => button.dataset.wordFloat))
			.toEqual(["dictionary", "occurrences", "related", "notes"]);
		root.querySelector<HTMLButtonElement>('[data-word-float="dictionary"]')?.click();
		root.querySelector<HTMLButtonElement>('[data-word-float="notes"]')?.click();
		expect(document.querySelectorAll(".floating-panel:not([hidden])")).toHaveLength(2);
		expect(document.querySelector("[data-floating-panel=\"dictionary\"]")?.textContent)
			.toContain("go down");
		expect(document.querySelector("[data-floating-panel=\"notes\"]")?.textContent)
			.toContain("Notes");
		const observation = root.querySelector<HTMLTextAreaElement>("[data-word-observation]");
		if (observation !== null)
		{
			observation.value = "A spatial and temporal descent.";
			observation.dispatchEvent(new Event("input", { bubbles: true }));
		}
		expect(document.querySelector<HTMLTextAreaElement>("[data-floating-panel=\"notes\"] [data-word-observation]")?.value)
			.toBe("A spatial and temporal descent.");
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
