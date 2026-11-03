import { describe, expect, it } from "vitest";
import { CreateDreamTextSelection } from "../../src/renderer/dreams/DreamTextSelection.js";
import { TextDocument } from "../../src/shared/library/LibraryTypes.js";
import type { TextSelection } from "../../src/shared/text/TextSelection.js";

const work = {
	id: "republic",
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "abcdef" },
		{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: "ghijkl" }
	]
} as TextDocument;

const source: TextSelection = {
	dialogue: "republic", text_version: `sha256:${"0".repeat(64)}`,
	start: { stephanus: "s1", offset: 2 },
	end: { stephanus: "s2", offset: 3 }
};

describe("Dream source selection", function DreamTextSelectionTests()
{
	it("maps a copied-source selection back to exact canonical coordinates", function MapsCopiedTextSelection()
	{
		const selection = CreateDreamTextSelection(work, source, 1, 7);

		expect(selection?.start).toEqual({ stephanus: "s1", offset: 3 });
		expect(selection?.end).toEqual({ stephanus: "s2", offset: 2 });
		const document = TextDocument.FromSnapshot(work);
		expect(selection === null ? "" : document.ReconstructText(selection)).toBe("def\ngh");
		expect(selection === null ? null : document.ResolveCitation(selection.start)?.value).toBe("327a");
		expect(selection === null ? null : document.ResolveCitation(selection.end)?.value).toBe("327b");
	});

	it("rejects an empty selection", function RejectsEmptySelection()
	{
		expect(CreateDreamTextSelection(work, source, 2, 2)).toBeNull();
	});
});
