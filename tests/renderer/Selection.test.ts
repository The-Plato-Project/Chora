// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { TextDocument } from "../../src/shared/library/LibraryTypes.js";
import { CaptureSelection } from "../../src/renderer/library/Selection.js";

const work: TextDocument = {
	id: "republic", textVersion: `sha256:${"0".repeat(64)}`, urn: null, title: "Republic", titleGreek: "Πολιτεία", author: "Plato", language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
	segments: [{
		key: "s1", citation: { system: "stephanus", value: "327a" }, division: null,
		text: "alpha beta gamma"
	}]
};

function CreatePassage(): { paragraph: HTMLElement; text: Text }
{
	document.body.innerHTML = '<div class="text-body"><p data-segment-key="s1"><span class="source-locator">327a</span><span class="segment-text">alpha beta gamma</span></p></div>';
	const paragraph = document.querySelector<HTMLElement>("[data-segment-key]")!;
	const text = paragraph.querySelector(".segment-text")!.firstChild as Text;
	return { paragraph, text };
}

afterEach(function Cleanup(): void
{
	window.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

describe("CaptureSelection", function CaptureSelectionTests()
{
	it("captures final words when Chromium places the endpoint after the text span", function CapturesFinalBoundary(): void
	{
		const { paragraph, text } = CreatePassage();
		const range = document.createRange();
		range.setStart(text, 11);
		range.setEnd(paragraph, paragraph.childNodes.length);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);

		const captured = CaptureSelection(work);

		expect(captured?.start).toEqual({ stephanus: "s1", offset: 11 });
		expect(captured?.end).toEqual({ stephanus: "s1", offset: 16 });
		expect(captured === null ? "" : TextDocument.FromSnapshot(work).ReconstructText(captured)).toBe("gamma");
	});

	it("captures the same final words when the reader drags backward from the passage end", function CapturesReverseFinalBoundary(): void
	{
		const { paragraph, text } = CreatePassage();
		const selection = window.getSelection()!;
		selection.setBaseAndExtent(paragraph, paragraph.childNodes.length, text, 11);

		const captured = CaptureSelection(work);

		expect(captured?.start).toEqual({ stephanus: "s1", offset: 11 });
		expect(captured?.end).toEqual({ stephanus: "s1", offset: 16 });
		expect(captured === null ? "" : TextDocument.FromSnapshot(work).ReconstructText(captured)).toBe("gamma");
	});

});
