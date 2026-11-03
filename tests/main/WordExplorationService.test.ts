import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { TextDocument } from "../../src/shared/text/TextDocument.js";
import { LibraryService } from "../../src/main/library/LibraryService.js";
import { WordExplorationService } from "../../src/main/library/WordExplorationService.js";
import { WordObservationRepository } from "../../src/main/library/WordObservationRepository.js";
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
	const service = new WordExplorationService(library, new PlatoSiGateway(client), observations);
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
					provider: "dilemma",
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
					source: { attribution: "Dilemma", revision: "revision" }
				}],
				forms: [{
					form: "κατέβην",
					count: 1,
					evidence: [{ provider: "dilemma", classification: "direct_lookup" }],
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
			dilemma: {
				status: "not_requested"
			},
			providers: [],
			warnings: [],
			limitations: "Direct mappings and explicit relations only."
		});
		const evidence = await fixture.service.GetEvidenceAsync(selection);
		expect(evidence.form).toBe("κατέβην");
		expect(evidence.possibilities[0].lemma).toBe("καταβαίνω");
		expect(evidence.dictionary.entries[0].plainText).toBe("go down");
		expect(evidence.lemmas[0].forms).toEqual([{
			form: "κατέβην",
			evidence: [{ provider: "dilemma", classification: "direct_lookup" }],
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
	});

	it("requests person research only for a valid canonical selection", async function RequestsPersonResearchAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		const result = await fixture.service.SearchAsync("republic", "κατέβην");
		const selection = result.occurrences[0].selection;
		const request = vi.spyOn(fixture.client, "RequestAsync");
		request.mockResolvedValue({
			contract: "platosi.person-research.v1",
			status: "ok",
			target: { location: selection },
			lemma: "Ἀρίστων",
			classification: {
				proper_name_candidate: true,
				basis: "Dilemma returned a capitalized lemma."
			},
			roots: ["ἄριστος"],
			summary: {
				person: "Ariston of Athens was Plato's father. [S1]",
				name_meaning: "A possible comparison is ἄριστος; this is not established here. [S2]",
				relationships: ["Father of Plato. [S1]"]
			},
			sources: [{
				id: "S1",
				kind: "wikidata",
				title: "Ariston of Athens",
				url: "https://www.wikidata.org/wiki/Q123",
				excerpt: "father of Plato",
				provider: "Wikidata",
				cached: false
			}],
			model: { provider: "ollama", model: "qwen3.5:9b" },
			warnings: []
		});
		const research = await fixture.service.GetPersonResearchAsync(selection, "Ἀρίστων");
		expect(research.summary?.person).toContain("[S1]");
		expect(research.roots).toEqual(["ἄριστος"]);
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
});
