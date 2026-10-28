import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { LibraryController } from "../../src/renderer/library/LibraryController.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import type { TextDocument, LibraryTextSummary, SourceNotice } from "../../src/shared/library/LibraryTypes.js";

const summary: LibraryTextSummary = {
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: null,
	author: "Plato",
	language: "grc",
	editor: null,
	fileName: "republic.json"
};

const document: TextDocument = {
	...summary,
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "PerseusDL", commit: "test", sourceFile: "republic.xml", license: "CC" },
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "abcdef" },
		{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: "ghijkl" }
	]
};

const sourceNotice: SourceNotice = {
	source: "PerseusDL",
	editor: null,
	editionTitle: null,
	repository: "PerseusDL",
	license: "CC"
};

describe("LibraryController", function LibraryControllerTests()
{
	let events: ChoraEventBus<ChoraEvents>;
	let controller: LibraryController;
	let store: LibraryStore;

	beforeEach(() =>
	{
		events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		vi.stubGlobal("window", {
			chora: {
				ListLibraryTexts: vi.fn(async () => ({ ok: true, value: [summary] })),
				LoadLibraryText: vi.fn(async () => ({ ok: true, value: document })),
				GetSourceNotice: vi.fn(async () => ({ ok: true, value: sourceNotice }))
			}
		});
		store = new LibraryStore();
		const dreams = {
			GetActiveDream: function GetActiveDream(): null
			{
				return null;
			},
			GetSelectedSignal: function GetSelectedSignal(): null
			{
				return null;
			}
		};
		controller = new LibraryController(events, errors, store, new LibraryGateway(), dreams);
	});

	it("loads the library and opens the preferred text", async function OpensPreferredText()
	{
		let opened = false;
		events.Subscribe("library.text-opened", () =>
		{
			opened = true;
		});

		await controller.StartAsync();

		expect(opened).toBe(true);
		expect(store.GetText()?.id).toBe(document.id);
		expect(store.GetText()?.segments.map(function GetText(segment): string
		{
			return segment.text;
		})).toEqual(["abcdef", "ghijkl"]);
		expect(store.GetSourceNotice()).toEqual(sourceNotice);
		expect(store.GetSnapshot().texts).toEqual([summary]);
	});

	it("canonicalizes repeated browser selections", async function CanonicalizesSelection()
	{
		await controller.StartAsync();
		const browserSelection = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 2 },
			end: { segmentKey: "s2", offset: 3 },
			selectedText: "browser formatting is ignored",
			locatorStart: null,
			locatorEnd: null
		};

		controller.SetSelection(browserSelection);
		controller.SetSelection(browserSelection);

		const selection = store.GetSelection();
		const text = store.GetText();
		expect(selection === null || text === null ? "" : text.ReconstructText(selection)).toBe("cdef\nghi");
		expect(selection === null || text === null ? null : text.ResolveCitation(selection.start)?.value).toBe("327a");
		expect(selection === null || text === null ? null : text.ResolveCitation(selection.end)?.value).toBe("327b");
	});

	it("rejects selections belonging to another document", async function RejectsWrongDocument()
	{
		vi.spyOn(console, "debug").mockImplementation(() => undefined);
		await controller.StartAsync();

		controller.SetSelection({ documentId: "other", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 2 }, selectedText: "ab", locatorStart: null, locatorEnd: null });

		expect(store.GetSelection()).toBeNull();
		expect(console.debug).toHaveBeenCalledWith("[Chora][DEBUG][LibraryController]", "Ignored an invalid browser selection.", expect.any(Error));
	});

	it("tracks the visible passage as chat context when no text is selected", async function TracksReadingFocus()
	{
		let focusedSegment = "";
		events.Subscribe("library.focus-changed", (event) =>
		{
			focusedSegment = event.segmentKey;
		});
		await controller.StartAsync();

		let selection = store.GetContextSelection();
		const text = store.GetText();
		expect(selection === null || text === null ? "" : text.ReconstructText(selection)).toBe("abcdef");
		controller.SetFocusSegment("s2");

		selection = store.GetContextSelection();
		expect(selection === null || text === null ? "" : text.ReconstructText(selection)).toBe("ghijkl");
		expect(focusedSegment).toBe("s2");
	});
});
