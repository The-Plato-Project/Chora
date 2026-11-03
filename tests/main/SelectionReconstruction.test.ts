import { describe, expect, it } from "vitest";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

const Version = `sha256:${"0".repeat(64)}`;

// Creates the canonical document used to verify exact-range behavior.
function CreateDocument(): TextDocument
{
	const document = new TextDocument({
		id: "republic",
		textVersion: Version,
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
			{ stephanus: "s1", offset: 0 },
			{ stephanus: "s2", offset: 12 });

		expect(document.ReconstructText(selection)).toBe("Κατέβην χθὲς\n εἰς Πειραιᾶ");
		expect(selection).toEqual({
			dialogue: "republic",
			text_version: Version,
			start: { stephanus: "s1", offset: 0 },
			end: { stephanus: "s2", offset: 12 }
		});
		expect(document.ResolveCitation(selection.start)?.value).toBe("327a");
		expect(document.ResolveCitation(selection.end)?.value).toBe("327b");
	});

	it("rejects offsets outside the canonical segment", function RejectsOffsets()
	{
		const document = CreateDocument();

		expect(function CreateInvalidSelection(): void
		{
			document.CreateSelection(
				{ stephanus: "s1", offset: -1 },
				{ stephanus: "s1", offset: 2 });
		}).toThrow("Invalid selection offset");
	});

	it("rejects selections from another document", function RejectsOtherDocuments()
	{
		const document = CreateDocument();

		expect(function ValidateOtherDocument(): void
		{
			document.ValidateSelection({
				dialogue: "other",
				text_version: Version,
				start: { stephanus: "s1", offset: 0 },
				end: { stephanus: "s1", offset: 2 }
			});
		}).toThrow("does not match the active document");
	});
});
