import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { TextDocument } from "../../src/shared/text/TextDocument.js";
import { LibraryService } from "../../src/main/library/LibraryService.js";
import { WordExplorationService } from "../../src/main/library/WordExplorationService.js";
import { WordObservationRepository } from "../../src/main/library/WordObservationRepository.js";
import { WordNameNoteRepository } from "../../src/main/library/WordNameNoteRepository.js";
import { PlatoSiClient } from "../../src/main/platosi/PlatoSiClient.js";
import { PlatoSiGateway } from "../../src/main/platosi/PlatoSiGateway.js";

function CreateFixture(): { service: WordExplorationService; document: TextDocument; library: LibraryService; client: PlatoSiClient }
{
	const document = TextDocument.FromSnapshot({
		id: "republic",
		textVersion: `sha256:${"0".repeat(64)}`,
		urn: null,
		title: "Republic",
		titleGreek: null,
		author: "Plato",
		language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
		segments: [{ key: "327a", citation: { system: "stephanus", value: "327a" }, text: "κατέβην χθὲς" }]
	});
	const repository = {
		ListAsync: async function ListAsync() { return []; },
		GetAsync: async function GetAsync() { return document; }
	};
	const library = new LibraryService(repository);
	vi.spyOn(library, "GetAsync");
	const client = new PlatoSiClient("python", "reader_api.py");
	const observations = new WordObservationRepository(path.join(tmpdir(), `chora-word-${randomUUID()}`));
	const nameNotes = new WordNameNoteRepository(
		path.join(tmpdir(), `chora-name-notes-${randomUUID()}`));
	const service = new WordExplorationService(
		library, new PlatoSiGateway(client), observations, nameNotes);
	const fixture = { service, document, library, client };
	return fixture;
}

describe("WordExplorationService", function WordExplorationServiceTests()
{
	it("finds exact forms with reconstructable positions in the bundled work", async function SearchesCanonicalTextAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		const decomposed = "κατέβην".normalize("NFD");
		const result = await fixture.service.SearchAsync("republic", decomposed);
		expect(result.form).toBe("κατέβην");
		expect(result.total).toBeGreaterThan(0);
		const first = result.occurrences[0];
		expect(first.citation).toBe("327a");
		const reconstructed = fixture.document.ReconstructText(first.selection);
		expect(reconstructed).toBe("κατέβην");
		const promise = fixture.service.SearchAsync("republic", "κατέβην χθὲς");
		await expect(promise).rejects.toThrow("Select a single Greek word without punctuation.");
	});

	it("reports the complete count while limiting returned passages", async function LimitsResultsAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		const snapshot = fixture.document.ToSnapshot();
		const repeated = "κατέβην ".repeat(201);
		const text = `${repeated}κατέβηνα`;
		const segment = { key: "sample", citation: null, text };
		const modified = { ...snapshot, segments: [segment] };
		const document = TextDocument.FromSnapshot(modified);
		vi.mocked(fixture.library.GetAsync).mockResolvedValue(document);
		const result = await fixture.service.SearchAsync("republic", "κατέβην");
		expect(result.total).toBe(201);
		expect(result.occurrences).toHaveLength(200);
	});

	it("requests organized PlatoSI evidence for the exact canonical selection", async function RequestsEvidenceAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		const result = await fixture.service.SearchAsync("republic", "κατέβην");
		const selection = result.occurrences[0].selection;
		const request = vi.spyOn(fixture.client, "RequestAsync");
		request.mockResolvedValue({
			contract: "platosi.dialogue-lexicon.v1",
			target: {
				location: selection,
				text: "κατέβην",
				context: [{ stephanus: "327a", text: "κατέβην χθὲς" }],
				source: {}
			},
			lemmas: [{
				lemma: "καταβαίνω",
				candidates: [{
					provider: "morpheus",
					provider_version: "1",
					method: "lookup",
					classification: "lookup_candidate",
					language: "grc",
					proper: false,
					rank: 1,
					via: "exact",
					citation: "unchanged",
					tag: "",
					settings: { resolve_articles: false },
					source: { attribution: "Morpheus", revision: "revision" }
				}],
				forms: [{
					form: "κατέβην",
					count: 1,
					evidence: [{ provider: "morpheus", classification: "direct_lookup" }],
					occurrences: [{
						location: selection,
						division: { type: "book", label: "1" },
						passage: "κατέβην χθὲς"
					}]
				}],
				related_lemmas: [],
				cache: {}
			}],
			dictionary: {
				status: "ok",
				entries: [{
					provider: "lsj-logeion",
					provider_version: "1",
					headword: "καταβαίνω",
					matched_term: "καταβαίνω",
					entry_id: "entry",
					plain_text: "go down",
					entry_xml: "<div2>go down</div2>",
					source: { attribution: "LSJ", revision: "revision" },
					license: { status: "test" }
				}],
				warnings: [],
				possibly_truncated: false
			},
			morphology: {
				status: "not_requested"
			},
			coverage: {
				analysis_providers: ["morpheus"], form_inventory_providers: ["morpheus"], analysis_only_providers: [],
				morphology_index_providers: ["morpheus"],
				morphology_indexes: [{ provider: "morpheus", state: "ready", checked_forms: 10,
					total_forms: 10, analyzed_forms: 9, unresolved_forms: 1, failed_forms: 0,
					pending_forms: 0, whole_dialogue_complete: true, context_reviewed: false }],
				cached_analysis_providers: [], cached_form_coverage: []
			},
			providers: [],
			warnings: [],
			limitations: "Direct mappings and explicit relations only."
		});
		const evidence = await fixture.service.GetEvidenceAsync(selection);
		expect(evidence.form).toBe("κατέβην");
		expect(evidence.coverage?.morphologyIndexProviders).toEqual(["morpheus"]);
		expect(evidence.coverage?.morphologyIndexes?.[0]).toEqual({ provider: "morpheus",
			state: "ready", checkedForms: 10, totalForms: 10, analyzedForms: 9,
			unresolvedForms: 1, failedForms: 0, pendingForms: 0,
			wholeDialogueComplete: true, contextReviewed: false });
		expect(evidence.possibilities[0].lemma).toBe("καταβαίνω");
		expect(evidence.dictionary.entries[0].plainText).toBe("go down");
		expect(evidence.lemmas[0].forms).toEqual([{
			form: "κατέβην",
			evidence: [{ provider: "morpheus", classification: "direct_lookup" }],
			occurrences: [{
				selection,
				citation: "327a",
				division: { type: "book", label: "1" },
				passage: "κατέβην χθὲς"
			}],
			total: 1
		}]);
		expect(request).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledWith("linguistics.dialogue-lexicon", { location: selection });

		// A lexical origin uses the same evidence decoder without inventing a source occurrence.
		const wire = await request.mock.results[0]!.value;
		const scope = { dialogue: selection.dialogue, text_version: selection.text_version };
		request.mockResolvedValue({ ...wire, contract: "platosi.lexical-evidence.v1", scope,
			occurrences_status: "indexed", target: { location: null, text: "καταβαίνω", context: [] } });
		const lexical = await fixture.service.GetLexicalEvidenceAsync("καταβαίνω", "republic");
		expect(lexical.selection).toBeNull();
		expect(lexical.work).toEqual(scope);
		expect(lexical.lemmas[0].forms[0].occurrences[0].selection).toEqual(selection);
		expect(request).toHaveBeenLastCalledWith("word.lookup", { lemma: "καταβαίνω", scope });
		request.mockResolvedValue({ ...wire, contract: "platosi.lexical-evidence.v1", scope: null,
			occurrences_status: "unavailable", target: { location: null, text: "πρός", context: [] },
			lemmas: [{ lemma: "πρός", candidates: [], forms: [], related_lemmas: [] }] });
		const standalone = await fixture.service.GetLexicalEvidenceAsync("πρός", null);
		expect(standalone.work).toBeNull();
		expect(standalone.occurrencesStatus).toBe("unavailable");
		request.mockResolvedValue({ contract: "platosi.word-search.v1", query: "προς",
			items: [{ lemma: "πρός" }], possibly_truncated: false, warnings: [] });
		expect((await fixture.service.SearchLexiconAsync("προς")).items).toEqual([{ lemma: "πρός" }]);
	});

	it("requests person research only for a valid canonical selection", async function RequestsPersonResearchAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		const result = await fixture.service.SearchAsync("republic", "κατέβην");
		const selection = result.occurrences[0].selection;
		const request = vi.spyOn(fixture.client, "RequestAsync");
		const source = {
			id: "S1", kind: "plato_prosopography", title: "Ariston of Athens",
			url: "https://humanisticadigitalia.eu/GreekTexts/Plato/#p-ariston",
			excerpt: "father of Plato", provider: "Platonis Humanistica Digitalia",
			cached: false, relevance: "plato_dialogue"
		};
		request.mockResolvedValue({
			contract: "platosi.person-research.v3",
			status: "ok",
			target: { location: selection },
			lemma: "Ἀρίστων",
			classification: { proper_name_candidate: true, basis: "A capitalized lemma." },
			overview: "Ariston of Athens was Plato's father. [S1]",
			sources: [source],
			candidates: [{
				id: "reference:ariston",
				label: "Ariston of Athens",
				sources: [source]
			}],
			model: { provider: "ollama", model: "qwen3.5:9b" },
			warnings: []
		});
		const research = await fixture.service.GetPersonResearchAsync(selection, "Ἀρίστων");
		expect(research.overview).toContain("[S1]");
		expect(research.sources).toHaveLength(1);
		expect(request).toHaveBeenCalledWith("linguistics.person-research", {
			location: selection,
			lemma: "Ἀρίστων"
		});
		const invalid = {
			...selection,
			start: { ...selection.start, offset: selection.end.offset },
			end: { ...selection.end, offset: selection.start.offset }
		};
		await expect(fixture.service.GetPersonResearchAsync(invalid, "Ἀρίστων")).rejects.toThrow();
		expect(request).toHaveBeenCalledOnce();
	});

	it("saves name notes by dialogue and normalized lemma", async function SavesNameNotesAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		await fixture.service.SaveNameNoteAsync({
			dialogue: "republic",
			lemma: "Πειραιεύς",
			text: "The port frames the opening descent."
		});
		const note = await fixture.service.GetNameNoteAsync({
			dialogue: "republic",
			lemma: "Πειραιεύς"
		});
		expect(note.text).toBe("The port frames the opening descent.");
	});
});
