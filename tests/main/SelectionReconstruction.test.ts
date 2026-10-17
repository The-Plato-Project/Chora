import { describe, expect, it } from "vitest";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

// Creates the canonical document used to verify exact-range behavior.
function CreateDocument(): TextDocument
{
	const document = new TextDocument({
		id: "republic",
		urn: null,
		title: "Republic",
		titleGreek: "Πολιτεία",
		author: "Plato",
		language: "grc",
		edition: { editor: "John Burnet", title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "test", commit: "test", sourceFile: "sample.xml", license: "test" },
		segments: [
			{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "Κατέβην χθὲς" },
			{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: " εἰς Πειραιᾶ" }
		]
	});

	return document;
}

describe("TextDocument selections", function TextDocumentSelectionTests()
{
	it("reconstructs a cross-segment selection and resolves its citations", function ReconstructsSelection()
	{
		const document = CreateDocument();
		const selection = document.CreateSelection(
			{ segmentKey: "s1", offset: 0 },
			{ segmentKey: "s2", offset: 12 });

		expect(document.ReconstructText(selection)).toBe("Κατέβην χθὲς\n εἰς Πειραιᾶ");
		expect(document.ResolveCitation(selection.start)?.value).toBe("327a");
		expect(document.ResolveCitation(selection.end)?.value).toBe("327b");
	});

	it("rejects offsets outside the canonical segment", function RejectsOffsets()
	{
		const document = CreateDocument();

		expect(function CreateInvalidSelection(): void
		{
			document.CreateSelection(
				{ segmentKey: "s1", offset: -1 },
				{ segmentKey: "s1", offset: 2 });
		}).toThrow("Invalid selection offset");
	});

	it("rejects selections from another document", function RejectsOtherDocuments()
	{
		const document = CreateDocument();

		expect(function ValidateOtherDocument(): void
		{
			document.ValidateSelection({
				documentId: "other",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 2 }
			});
		}).toThrow("does not match the active document");
	});
});
