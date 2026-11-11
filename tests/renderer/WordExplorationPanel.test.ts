// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextDocument, type TextDocumentSnapshot } from "../../src/shared/text/TextDocument.js";
import type { WordEvidenceResult, WordSearchResult } from "../../src/shared/library/WordExplorationTypes.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { WordExplorationStore } from "../../src/renderer/library/words/WordExplorationStore.js";
import { WordExplorationGateway } from "../../src/renderer/library/words/WordExplorationGateway.js";
import { WordExplorationController } from "../../src/renderer/library/words/WordExplorationController.js";
import { WordExplorationPanel } from "../../src/renderer/library/words/WordExplorationPanel.js";
import { WordSearchPanel } from "../../src/renderer/library/words/WordSearchPanel.js";
import { WordVisionReferenceStore } from "../../src/renderer/library/words/WordVisionReferenceStore.js";

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
		const panelRule = css.match(/\.word-exploration\s*\{(?<declarations>[^}]*)\}/s);
		const headingRule = css.match(/\.word-exploration \[data-word-content\] \.word-column-heading\s*\{(?<declarations>[^}]*)\}/s);
		const contentRule = css.match(/\.word-person-content\s*\{(?<declarations>[^}]*)\}/s);
		const controls = readFileSync("src/renderer/styles/controls.css", "utf8");
		const occurrenceRule = controls.match(/\.word-occurrence-navigation \.control-list-row\s*\{(?<declarations>[^}]*)\}/s);

		expect(panelRule?.groups?.declarations).toMatch(/--word-content-inline-padding:\s*1rem;/);
		expect(headingRule?.groups?.declarations)
			.toMatch(/padding:\s*0\.62rem var\(--word-content-inline-padding\);/);
		expect(contentRule?.groups?.declarations).toMatch(/box-sizing:\s*border-box;/);
		expect(contentRule?.groups?.declarations).toMatch(/width:\s*100%;/);
		expect(contentRule?.groups?.declarations)
			.toMatch(/padding:\s*0\.55rem var\(--word-content-inline-padding\) 1rem;/);
		expect(contentRule?.groups?.declarations).not.toMatch(/max-width:/);
		expect(occurrenceRule?.groups?.declarations)
			.toMatch(/padding-inline:\s*var\(--word-content-inline-padding\);/);
	});

	it("lists occurrences without book divisions in Stephanus order", function OrdersNonBookOccurrences(): void
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const root = document.createElement("section");
		document.body.append(root);
		const store = new WordExplorationStore();
		const references = new WordVisionReferenceStore();
		const occurrenceEvidence = vi.fn().mockResolvedValue(null);
		const panel = new WordExplorationPanel(
			root,
			events,
			store,
			{ GetOccurrenceEvidenceAsync: occurrenceEvidence, SelectOccurrence: store.SetSelectedOccurrence.bind(store) } as unknown as WordExplorationController,
			references);
		const version = `sha256:${"0".repeat(64)}`;
		function CreateOccurrence(citation: string)
		{
			return {
				selection: {
					dialogue: "apology",
					text_version: version,
					start: { stephanus: citation, offset: 0 },
					end: { stephanus: citation, offset: 3 }
				},
				citation,
				division: null,
				passage: "abc context"
			};
		}
		const later = CreateOccurrence("40a");
		const earlier = CreateOccurrence("17a");
		const evidence = {
			selection: earlier.selection,
			lemmas: [{
				lemma: "abc",
				forms: [{ form: "abc", occurrences: [later, earlier] }],
				relatedLemmas: []
			}]
		} as unknown as WordEvidenceResult;
		const renderer = panel as unknown as {
			content: HTMLElement;
			RenderDialogueForms(value: WordEvidenceResult, lemma: string): string;
			MountOccurrenceLists(host: HTMLElement): void;
		};

		store.Select(earlier.selection, "abc");
		root.innerHTML = renderer.RenderDialogueForms(evidence, "abc");
		renderer.content = root;
		renderer.MountOccurrenceLists(root);

		expect(root.querySelector(".word-occurrence-book")).toBeNull();
		expect(Array.from(root.querySelectorAll(".control-list-detail"), (item) => item.textContent))
			.toEqual(["17a", "40a"]);
		expect(root.querySelectorAll(".control-list-row")).toHaveLength(2);
		expect(root.querySelector(".word-occurrence-detail")?.textContent).toContain("abc context");
		expect(root.textContent).not.toContain("No linked Visions");
		root.querySelectorAll<HTMLButtonElement>(".control-list-row")[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
		expect(root.querySelectorAll(".control-list-row")[1]?.classList.contains("selected")).toBe(true);
		expect(root.querySelector(".word-occurrence-detail-location")).toBeNull();
		expect(occurrenceEvidence).toHaveBeenCalledWith(later.selection);
		panel.Dispose();
	});

	it("selects the invoked occurrence and includes its Book in the location", function SelectsInvokedOccurrence(): void
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const root = document.createElement("section");
		document.body.append(root);
		const store = new WordExplorationStore();
		const panel = new WordExplorationPanel(
			root,
			events,
			store,
			{} as WordExplorationController,
			new WordVisionReferenceStore());
		const version = `sha256:${"0".repeat(64)}`;
		function CreateOccurrence(book: string, citation: string)
		{
			return {
				selection: {
					dialogue: "republic",
					text_version: version,
					start: { stephanus: citation, offset: 0 },
					end: { stephanus: citation, offset: 3 }
				},
				citation,
				division: { type: "book", label: book },
				passage: `abc in Book ${book}`
			};
		}
		const bookOne = CreateOccurrence("1", "327a");
		const bookTwo = CreateOccurrence("2", "357a");
		const evidence = {
			selection: bookTwo.selection,
			lemmas: [{
				lemma: "abc",
				forms: [{ form: "abc", occurrences: [bookOne, bookTwo] }],
				relatedLemmas: []
			}]
		} as unknown as WordEvidenceResult;
		const renderer = panel as unknown as {
			content: HTMLElement;
			RenderDialogueForms(value: WordEvidenceResult, lemma: string): string;
			MountOccurrenceLists(host: HTMLElement): void;
		};

		store.Select(bookTwo.selection, "abc");
		root.innerHTML = renderer.RenderDialogueForms(evidence, "abc");
		renderer.content = root;
		renderer.MountOccurrenceLists(root);

		expect(root.querySelector(".word-occurrence-book")).toBeNull();
		expect(Array.from(root.querySelectorAll(".control-list-detail"), (item) => item.textContent))
			.toEqual(["Book 1 327a", "Book 2 357a"]);
		expect(root.querySelector(".control-list-row.selected .control-list-detail")?.textContent)
			.toBe("Book 2 357a");
		expect(root.querySelector(".word-occurrence-detail-location")).toBeNull();
		panel.Dispose();
	});

	it("updates morphology when the selected occurrence changes", async function UpdatesOccurrenceMorphology(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const root = document.createElement("section");
		document.body.append(root);
		const store = new WordExplorationStore();
		const version = `sha256:${"0".repeat(64)}`;
		function CreateOccurrence(form: string, citation: string)
		{
			return {
				selection: {
					dialogue: "republic",
					text_version: version,
					start: { stephanus: citation, offset: 0 },
					end: { stephanus: citation, offset: form.length }
				},
				citation,
				division: { type: "book", label: "1" },
				passage: `${form} context`
			};
		}
		const first = CreateOccurrence("abc", "327a");
		const second = CreateOccurrence("def", "328b");
		const sourceEvidence = {
			selection: first.selection,
			form: "abc",
			possibilities: [{
				lemma: "lemma",
				candidates: [{ tag: "", homograph: null, features: { tense: "aorist" } }]
			}],
			lemmas: [{
				lemma: "lemma",
				forms: [
					{ form: "abc", occurrences: [first] },
					{ form: "def", occurrences: [second] }
				],
				relatedLemmas: []
			}],
			warnings: []
		} as unknown as WordEvidenceResult;
		const selectedEvidence = {
			...sourceEvidence,
			selection: second.selection,
			form: "def",
			possibilities: [{
				lemma: "lemma",
				candidates: [{ tag: "", homograph: null, features: { tense: "present" } }]
			}]
		} as unknown as WordEvidenceResult;
		const loadEvidence = vi.fn().mockResolvedValue(selectedEvidence);
		const panel = new WordExplorationPanel(
			root,
			events,
			store,
			{ GetOccurrenceEvidenceAsync: loadEvidence, SelectOccurrence: store.SetSelectedOccurrence.bind(store) } as unknown as WordExplorationController,
			new WordVisionReferenceStore());
		const renderer = panel as unknown as {
			content: HTMLElement;
			RenderDialogueForms(value: WordEvidenceResult, lemma: string): string;
			MountOccurrenceLists(host: HTMLElement): void;
		};

		store.Select(first.selection, "abc");
		store.SetEvidence(sourceEvidence);
		store.SelectLemma("lemma");
		root.innerHTML = renderer.RenderDialogueForms(sourceEvidence, "lemma");
		renderer.content = root;
		renderer.MountOccurrenceLists(root);

		expect(root.querySelector(".word-analysis-context")?.textContent)
			.toBe("Possible readings of abc as lemma.");
		expect(root.querySelector(".word-analysis-grammar")?.textContent).toBe("aorist");
		root.querySelectorAll<HTMLButtonElement>(".control-list-row")[1]?.click();
		expect(root.querySelector(".word-occurrence-morphology-status")?.textContent)
			.toBe("Loading morphology…");
		await vi.waitFor(function MorphologyUpdated(): void
		{
			expect(loadEvidence).toHaveBeenCalledWith(second.selection);
			expect(root.querySelector(".word-analysis-context")?.textContent)
				.toBe("Possible readings of def as lemma.");
			expect(root.querySelector(".word-analysis-grammar")?.textContent).toBe("present");
			expect(root.querySelector(".word-occurrence-morphology-status")).toBeNull();
		});
		panel.Dispose();
	});

	it("keeps multiple word lookups in reusable tabs", async function KeepsMultipleWordTabs(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const root = document.createElement("section");
		document.body.append(root);
		const store = new WordExplorationStore();
		const version = `sha256:${"0".repeat(64)}`;
		store.Select({
			dialogue: "republic", text_version: version,
			start: { stephanus: "327a", offset: 0 },
			end: { stephanus: "327a", offset: 7 }
		}, "κατέβην");
		const secondId = store.Select({
			dialogue: "republic", text_version: version,
			start: { stephanus: "327a", offset: 8 },
			end: { stephanus: "327a", offset: 12 }
		}, "χθὲς");
		const selectTab = vi.fn().mockResolvedValue(undefined);
		const closeTab = vi.fn().mockResolvedValue(undefined);
		const controller = {
			SelectTabAsync: selectTab,
			CloseTabAsync: closeTab
		} as unknown as WordExplorationController;
		const panel = new WordExplorationPanel(
			root,
			events,
			store,
			controller,
			new WordVisionReferenceStore());

		const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		expect(Array.from(tabs, (tab) => tab.textContent)).toEqual(["κατέβην", "χθὲς"]);
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
		tabs[0]?.click();
		expect(selectTab).toHaveBeenCalledWith(store.GetTabs()[0]?.id);
		root.querySelector<HTMLButtonElement>(`[data-tab-close="${secondId}"]`)?.click();
		expect(closeTab).toHaveBeenCalledWith(secondId);
		panel.Dispose();

		// The same tab surface accepts a dictionary origin without any open canonical work.
		const lexicalStore = new WordExplorationStore();
		const lexicalRoot = document.createElement("section");
		const searchRoot = document.createElement("section");
		document.body.append(lexicalRoot, searchRoot);
		const lexicalEvidence = { contract: "platosi.lexical-evidence.v1", selection: null, work: null,
			occurrencesStatus: "unavailable", form: "πρός", context: [], possibilities: [{ lemma: "πρός", candidates: [] }],
			lemmas: [{ lemma: "πρός", candidates: [], forms: [], relatedLemmas: [] }],
			dictionary: { status: "empty", entries: [], possiblyTruncated: false }, morphology: { status: "not_requested" },
			warnings: [], limitations: "" };
		const lexicalGateway = {
			SearchLexiconAsync: vi.fn().mockResolvedValue({ query: "προς", items: [{ lemma: "πρός" }], possiblyTruncated: false, warnings: [] }),
			GetLexicalEvidenceAsync: vi.fn().mockResolvedValue(lexicalEvidence)
		};
		const lexicalController = new WordExplorationController(events, new ErrorManager(events), new LibraryStore(),
			{ RevealSelectionAsync: vi.fn() }, lexicalStore, lexicalGateway as unknown as WordExplorationGateway);
		const lexicalPanel = new WordExplorationPanel(lexicalRoot, events, lexicalStore, lexicalController, new WordVisionReferenceStore());
		const search = new WordSearchPanel(searchRoot, events, lexicalStore, lexicalController);
		const input = searchRoot.querySelector<HTMLInputElement>("input")!;
		input.value = "προς";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		searchRoot.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(function SearchCompleted(): void
		{
			expect(searchRoot.querySelector(".control-list-row")?.textContent).toBe("πρός");
		});
		searchRoot.querySelector<HTMLButtonElement>(".control-list-row")!.click();
		await vi.waitFor(function LexicalTabOpened(): void
		{
			expect(lexicalRoot.hidden).toBe(false);
			expect(lexicalRoot.querySelector('[role="tab"]')?.textContent).toBe("πρός");
			expect(lexicalRoot.textContent).toContain("Open a work to see occurrences.");
		});
		expect(lexicalStore.GetWorkspaceState().tabs[0]).toMatchObject({ selection: null, lexicalLemma: "πρός" });
		search.Dispose();
		lexicalPanel.Dispose();
		lexicalController.Dispose();
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
		const visionReferences = new WordVisionReferenceStore();
		visionReferences.Set(selection.dialogue, [{
			selection,
			reference: {
				visionId: "123e4567-e89b-42d3-a456-426614174000",
				visionTitle: "Descent",
				placementId: "placement:123e4567-e89b-42d3-a456-426614174002",
				excerpt: "The reader asks why κατέβην begins this account."
			}
		}]);
		const root = document.createElement("section");
		document.body.append(root);
		const panel = new WordExplorationPanel(root, events, store, controller, visionReferences);
		expect(root.hidden).toBe(true);
		expect(root.querySelector("[data-resize-pane]")).toBeNull();
		expect(root.style.height).toBe("");
		await events.PublishAsync("word.exploration-requested", { selection });
		expect(root.hidden).toBe(false);
		expect(root.querySelector(":scope > header")).toBeNull();
		expect(root.textContent).not.toContain("Word lookup");
		expect(root.querySelector('[role="tab"]')?.textContent).toBe("Choose lemma");
		expect(root.querySelector("[data-word-close]")?.textContent).toBe("");
		expect(root.querySelector("[data-word-close] svg")).not.toBeNull();
		expect(root.querySelector("[data-word-close]")?.getAttribute("aria-label")).toBe("Close word lookup");
		expect(root.querySelector(".word-evidence-target")).toBeNull();
		expect(evidence).toHaveBeenCalledWith(selection);
		expect(personResearch).not.toHaveBeenCalled();
		expect(gateway.SearchAsync).not.toHaveBeenCalled();
		expect(root.querySelector(".word-lemma-chooser h3")?.textContent).toBe("Choose a lemma for κατέβην");
		const lemmaChoices = root.querySelectorAll<HTMLButtonElement>("[data-word-lemma-index]");
		expect(Array.from(lemmaChoices, (choice) => choice.textContent))
			.toEqual(["καταβαίνω", "κατάβασις"]);
		expect(root.querySelectorAll(".split-divider")).toHaveLength(0);
		lemmaChoices[0]?.click();
		await vi.waitFor(function FirstLemmaSelected(): void
		{
			expect(root.querySelector('[role="tab"]')?.textContent).toBe("καταβαίνω");
			expect(root.querySelector(".word-dictionary-section")).not.toBeNull();
			expect(root.querySelector(".word-occurrences-section")).not.toBeNull();
		});
		expect(root.textContent).not.toContain("Lemmas");
		expect(root.querySelectorAll(".word-evidence-split > .split-pane")).toHaveLength(2);
		const primaryResize = root.querySelector<HTMLElement>('.word-evidence-split > .split-divider');
		primaryResize?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(window.localStorage.getItem("chora:layout-settings"))
			.toContain('"dictionary":{"Size":424,"Collapsed":false}');
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
		expect(root.querySelector(".word-occurrence-morphology > h4")?.textContent)
			.toBe("Morphology");
		const columnSections = root.querySelectorAll<HTMLElement>(".word-evidence-split > .split-pane > section");
		expect(columnSections).toHaveLength(2);
		for (const section of columnSections)
		{
			expect(section.querySelector(":scope > .word-column-heading")).not.toBeNull();
		}
		expect(root.querySelector(".word-occurrence-morphology [data-word-float]")).toBeNull();
		expect(root.querySelector(".word-lemma-section [data-word-float]")).toBeNull();
		expect(root.textContent).not.toContain("These are possible readings of the selected word");
		const css = readFileSync("src/renderer/styles/base.css", "utf8");
		expect(css).toMatch(/\.word-exploration\s*\{[^}]*padding:\s*0;/s);
		expect(css).toMatch(/\.word-exploration\s*\{[^}]*font-family:\s*var\(--reading-font\);[^}]*font-size:\s*var\(--reading-font-size\);/s);
		expect(css).toMatch(/\.word-lookup-tabs > \.tab-list\s*\{[^}]*font-family:\s*var\(--ui-font\);/s);
		expect(css).toMatch(/\.word-column-heading\s*\{[^}]*font-family:\s*var\(--ui-font\);/s);
		expect(css).toMatch(/\.word-dictionary-entry\s*\{[^}]*font-size:\s*inherit;/s);
		expect(css).toMatch(/\.word-person-note textarea\s*\{[^}]*font:\s*inherit;/s);
		const sharedControls = readFileSync("src/renderer/styles/controls.css", "utf8");
		expect(sharedControls).toMatch(/\.control-list-row\s*\{[^}]*font:\s*inherit;/s);
		expect(css).toMatch(/\.word-occurrence-passage\s*\{[^}]*font:\s*inherit;/s);
		expect(css).toMatch(/\.word-lookup-tabs > \.tab-list \.tab-item\s*\{[^}]*border:\s*1px solid var\(--panel-border\);[^}]*border-radius:\s*0;/s);
		expect(css).toMatch(/\.word-lookup-tabs > \.tab-list \.tab-item:has\(\[aria-selected="true"\]\)\s*\{[^}]*box-shadow:\s*0 -2px 0 var\(--accent\);/s);
		expect(sharedControls).toMatch(/\.control-window-close svg\s*\{[^}]*stroke:\s*currentColor;/s);
		const splitStyles = readFileSync("src/renderer/styles/split-view.css", "utf8");
		expect(splitStyles).toMatch(/\.split-divider::after\s*\{[^}]*background:\s*var\(--muted-text\);/s);
		expect(css).toMatch(/\.multiline-input\s*\{[^}]*border:\s*1px solid var\(--panel-border\);/s);
		expect(splitStyles).toMatch(/\.split-view\[data-split-direction="rows"\]\s*\{[^}]*flex-direction:\s*column;/s);
		expect(css).not.toContain(".word-occurrence-book");
		expect(root.querySelector(".word-analysis-notices")?.textContent).toContain("fixture notice");
		expect(root.textContent).toContain("go down");
		expect(root.querySelector(".word-dictionary-entry")?.textContent).toContain("go down");
		expect(root.querySelector(".word-dictionary-entry")?.textContent?.trim().startsWith("καταβαίνω"))
			.toBe(true);
		const dictionary = root.querySelector<HTMLElement>(".word-dictionary-content");
		expect(dictionary).not.toBeNull();
		expect(root.querySelector(".word-occurrences-heading h3")?.textContent).toBe("Occurrences (1)");
		const occurrenceHeading = root.querySelector<HTMLElement>(".word-occurrences-heading");
		expect(occurrenceHeading?.tagName).toBe("HEADER");
		expect(root.querySelector(".word-occurrences-heading > span")).toBeNull();
		expect(css).toMatch(/\.word-occurrence-master-detail\s*\{[^}]*border-top:\s*1px solid color-mix\(in srgb, var\(--panel-border\) 55%, transparent\);/s);
		expect(root.querySelector(".word-occurrence-coverage")).toBeNull();
		expect(root.textContent).not.toContain("Coverage");
		expect(root.querySelector(".word-occurrence-book")).toBeNull();
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
			.not.toContain("Notes");
		const highlighted = root.querySelector<HTMLElement>(".word-occurrence-form");
		expect(highlighted?.textContent).toBe("κατέβην");
		expect(highlighted?.tagName).toBe("BUTTON");
		expect(css).not.toMatch(/\.word-occurrence-form\s*\{[^}]*#e4bd52/s);
		expect(css).toMatch(/\.word-occurrence-form\s*\{[^}]*color:\s*var\(--accent\);/s);
		const navigationRow = root.querySelector<HTMLButtonElement>(".control-list-row");
		expect(navigationRow?.classList.contains("selected")).toBe(true);
		expect(navigationRow?.textContent).toContain("κατέβην");
		expect(navigationRow?.textContent).toContain("Book 1 327a");
		const visionIndicator = navigationRow?.querySelector<HTMLElement>(".word-occurrence-reference-indicator");
		expect(visionIndicator?.closest(".control-list-primary")?.querySelector(".control-list-text")).not.toBeNull();
		expect(visionIndicator?.title).toBe("View 1 Vision citing this occurrence");
		expect(visionIndicator?.getAttribute("aria-label")).toBe("View 1 Vision citing this occurrence");
		navigationRow?.click();
		expect(revealSelection).not.toHaveBeenCalled();
		const occurrenceDetail = root.querySelector<HTMLElement>(".word-occurrence-detail");
		expect(occurrenceDetail?.querySelector(".word-occurrence-detail-location")).toBeNull();
		expect(occurrenceDetail?.querySelector(".word-occurrence-passage")?.textContent).toContain("κατέβην χθὲς");
		occurrenceDetail?.querySelector<HTMLButtonElement>(".word-occurrence-passage .word-occurrence-form")?.click();
		await vi.waitFor(function ExcerptOccurrenceRevealed(): void
		{
			expect(revealSelection).toHaveBeenCalledWith(selection, "word");
		});
		expect(occurrenceDetail?.querySelector("[data-word-vision-references] .word-column-heading h3")?.textContent).toBe("Visions (1)");
		expect(occurrenceDetail?.querySelector(".word-vision-title")?.textContent).toBe("Descent");
		expect(occurrenceDetail?.querySelector(".word-vision-excerpt")?.textContent).toContain("The reader asks why");
		expect(occurrenceDetail?.querySelector(".word-occurrence-morphology")).not.toBeNull();
		expect(occurrenceDetail?.querySelector(".word-occurrence-morphology")?.closest("[data-word-excerpt-pane]")).not.toBeNull();
		expect(css).toMatch(/\.word-exploration \[data-word-content\]\s*\{[^}]*overflow:\s*hidden;/s);
		expect(root.querySelectorAll(".word-occurrence-master-detail > .split-pane")).toHaveLength(2);
		expect(css).toMatch(/\.word-occurrence-navigation\s*\{[^}]*overflow:\s*auto;/s);
		expect(css).toMatch(/\.word-occurrence-excerpt-body\s*\{[^}]*overflow:\s*auto;/s);
		expect(css).toMatch(/\.word-occurrence-passage\s*\{[^}]*max-width:\s*72rem;/s);
		expect(css).toMatch(/\.word-occurrence-visions\s*\{[^}]*overflow:\s*auto;/s);
		expect(css).toMatch(/\.word-occurrence-morphology\s*\{[^}]*max-width:\s*none;/s);
		const occurrenceResize = root.querySelector<HTMLElement>(".word-occurrence-master-detail > .split-divider");
		expect(occurrenceResize).not.toBeNull();
		occurrenceResize?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(window.localStorage.getItem("chora:layout-settings"))
			.toContain('"list":{"Size":324,"Collapsed":false}');
		const evidenceResize = root.querySelector<HTMLElement>(".word-occurrence-evidence > .split-divider");
		expect(root.querySelectorAll(".word-occurrence-evidence > .split-pane")).toHaveLength(2);
		expect(evidenceResize?.getAttribute("aria-label")).toBe("Resize Excerpt and Visions");
		evidenceResize?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
		expect(window.localStorage.getItem("chora:layout-settings"))
			.toContain('"visions":{"Size":280,"Collapsed":true}');
		evidenceResize?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		let openedReference: ChoraEvents["vision.reference-open-requested"] | null = null;
		events.Subscribe("vision.reference-open-requested", function CaptureReference(event): void
		{
			openedReference = event;
		});
		occurrenceDetail?.querySelector<HTMLButtonElement>("[data-word-vision-id]")?.click();
		await vi.waitFor(function VisionReferenceOpened(): void
		{
			expect(openedReference).toEqual({
				visionId: "123e4567-e89b-42d3-a456-426614174000",
				placementId: "placement:123e4567-e89b-42d3-a456-426614174002"
			});
		});
		const floatButtons = root.querySelectorAll<HTMLButtonElement>("[data-word-float]");
		expect(Array.from(floatButtons, (button) => button.dataset.wordFloat))
			.toEqual(["dictionary", "related", "occurrences"]);
		root.querySelector<HTMLButtonElement>('[data-word-float="dictionary"]')?.click();
		expect(document.querySelectorAll(".floating-panel:not([hidden])")).toHaveLength(1);
		expect(document.querySelector("[data-floating-panel=\"dictionary\"]")?.textContent)
			.toContain("go down");
		expect(root.querySelector("[data-word-observation]")).toBeNull();

		const passageNode = occurrenceDetail?.querySelector(".word-occurrence-passage");
		const morphologyNode = occurrenceDetail?.querySelector(".word-occurrence-morphology");
		const navigationNode = root.querySelector(".word-occurrence-navigation");
		const floatingDictionary = document.querySelector('[data-floating-panel="dictionary"] .word-dictionary-entry');
		const changedKeys = visionReferences.Set(selection.dialogue, [{
			selection,
			reference: {
				visionId: "123e4567-e89b-42d3-a456-426614174000",
				visionTitle: "Descent revised",
				placementId: "placement:123e4567-e89b-42d3-a456-426614174002",
				excerpt: "A revised question about κατέβην and the telling of a story."
			}
		}]);
		await events.PublishAsync("word.vision-references-changed", { workId: selection.dialogue, selectionKeys: changedKeys });
		expect(occurrenceDetail?.querySelector(".word-vision-title")?.textContent).toBe("Descent revised");
		expect(occurrenceDetail?.querySelector(".word-vision-excerpt")?.textContent).toContain("A revised question");
		expect(root.querySelector(".word-occurrence-evidence > .split-divider")).toBe(evidenceResize);
		expect(root.querySelector(".word-dictionary-content")).toBe(dictionary);
		expect(root.querySelector(".word-occurrence-navigation")).toBe(navigationNode);
		expect(occurrenceDetail?.querySelector(".word-occurrence-passage")).toBe(passageNode);
		expect(occurrenceDetail?.querySelector(".word-occurrence-morphology")).toBe(morphologyNode);
		expect(document.querySelector('[data-floating-panel="dictionary"] .word-dictionary-entry')).toBe(floatingDictionary);
		expect(relatedRow?.open).toBe(true);

		await events.PublishAsync("word.exploration-requested", { selection });
		expect(Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'), (tab) => tab.textContent))
			.toEqual(["καταβαίνω", "Choose lemma"]);
		expect(evidence).toHaveBeenCalledTimes(1);
		root.querySelectorAll<HTMLButtonElement>("[data-word-lemma-index]")[1]?.click();
		await vi.waitFor(function SecondLemmaSelected(): void
		{
			const selectedPanel = root.querySelector<HTMLElement>(".word-lookup-tab-panel:not([hidden])");
			expect(Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'), (tab) => tab.textContent))
				.toEqual(["καταβαίνω", "κατάβασις"]);
			expect(personResearch).toHaveBeenCalledWith(selection, "κατάβασις");
			expect(selectedPanel?.querySelectorAll(".word-name-overview")).toHaveLength(1);
			expect(selectedPanel?.querySelector(".word-occurrences-heading h3")?.textContent).toBe("Occurrences (0)");
			expect(selectedPanel?.querySelector(".word-occurrence-empty")?.textContent)
				.toContain("does not establish that the lemma is absent");
			expect(selectedPanel?.querySelector(".word-name-overview")?.textContent)
				.toBe("Polemarchus was the eldest son of Cephalus. [S2]");
			expect(selectedPanel?.querySelectorAll("[data-person-source]")).toHaveLength(1);
			expect(selectedPanel?.querySelector<HTMLTextAreaElement>("[data-word-name-note]")?.value)
				.toBe("The port matters to this dialogue.");
		});
		const selectedPanel = root.querySelector<HTMLElement>(".word-lookup-tab-panel:not([hidden])");
		const overview = selectedPanel?.querySelector(".word-name-overview");
		expect(overview?.nextElementSibling?.classList.contains("word-person-sources")).toBe(true);
		expect(root.textContent).not.toContain("Show evidence");
		expect(root.textContent).not.toContain("Research details");
		expect(selectedPanel?.querySelector(".word-person-issues")).toBeNull();
		expect(selectedPanel?.querySelector("[data-word-content] > .word-person-section")).toBeNull();
		expect(selectedPanel?.querySelector(".word-dictionary-section .word-person-section")).not.toBeNull();
		const nameNote = selectedPanel?.querySelector<HTMLTextAreaElement>("[data-word-name-note]") ?? null;
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
		selectedPanel?.querySelector<HTMLAnchorElement>("[data-person-source]")?.click();
		await vi.waitFor(function SourceOpened(): void
		{
			expect(openSource).toHaveBeenCalledWith(
				"https://humanisticadigitalia.eu/GreekTexts/Plato/#p-polemarchus");
		});
		root.querySelector<HTMLButtonElement>("[data-word-close]")?.click();
		expect(root.hidden).toBe(true);
		panel.Dispose();
		controller.Dispose();
	});
});
