import { describe, expect, it, vi } from "vitest";
import { PlatoSiLibraryRepository } from "../../src/main/library/PlatoSiLibraryRepository.js";
import { PlatoSiClient } from "../../src/main/platosi/PlatoSiClient.js";
import { PlatoSiGateway } from "../../src/main/platosi/PlatoSiGateway.js";

// Creates a repository backed by one canonical PlatoSI response.
function CreateFixture(): { repository: PlatoSiLibraryRepository; sections: Record<string, unknown>[] }
{
	const version = `sha256:${"0".repeat(64)}`;
	const sections: Record<string, unknown>[] = [{
		stephanus: "327a",
		division: { type: "book", label: "1" },
		segments: [
			{ text: "κατέβην χθὲς", annotations: [] },
			{ text: "εἰς Πειραιᾶ", annotations: [] }
		]
	}];
	const entry = {
		dialogue: "republic",
		title: "Republic",
		title_greek: "Πολιτεία",
		author: "Plato",
		language: "grc",
		text_version: version
	};
	const source = {
		repository: "https://example.test/corpus",
		revision: "revision",
		source_file: "republic.xml",
		text_id: "urn:cts:greekLit:tlg0059.tlg030.perseus-grc2",
		attribution: "Test",
		license: "CC BY-SA 4.0"
	};
	const client = new PlatoSiClient("python", "reader_api.py");
	vi.spyOn(client, "RequestAsync").mockImplementation(async function RespondAsync(operation: string): Promise<unknown>
	{
		let result: unknown;
		if (operation === "canonical.catalog")
		{
			result = { contract: "platosi.location.v1", works: [entry] };
		}
		else
		{
			result = { contract: "platosi.location.v1", dialogue: "republic", text_version: version, source, sections };
		}
		return result;
	});
	return { repository: new PlatoSiLibraryRepository(new PlatoSiGateway(client)), sections };
}

describe("PlatoSiLibraryRepository", function PlatoSiLibraryRepositoryTests()
{
	it("uses PlatoSI sections and versioned locations without a bundled corpus", async function LoadsCanonicalWorkAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		const catalogue = await fixture.repository.ListAsync();
		const document = await fixture.repository.GetAsync("republic");
		const selection = document.CreateSelection(
			{ stephanus: "327a", offset: 0 },
			{ stephanus: "327a", offset: 7 });
		expect(catalogue[0].id).toBe("republic");
		expect(document.textVersion).toBe(`sha256:${"0".repeat(64)}`);
		expect(document.segments).toHaveLength(1);
		expect(document.segments[0]?.text).toBe("κατέβην χθὲς\nεἰς Πειραιᾶ");
		expect(selection).toEqual({
			dialogue: "republic",
			text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus: "327a", offset: 0 },
			end: { stephanus: "327a", offset: 7 }
		});
		expect(document.ReconstructText(selection)).toBe("κατέβην");
	});

	it("rejects duplicate canonical section references", async function RejectsDuplicateSectionsAsync(): Promise<void>
	{
		const fixture = CreateFixture();
		fixture.sections.push(structuredClone(fixture.sections[0]));
		await expect(fixture.repository.GetAsync("republic")).rejects.toThrow("invalid canonical section");
	});
});
