// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ReadingSettingsStore } from "../../src/renderer/core/settings/ReadingSettingsStore.js";
import { DocumentPanel } from "../../src/renderer/library/DocumentPanel.js";
import { LibraryController } from "../../src/renderer/library/LibraryController.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import type { TextDocument, LibraryTextSummary, SourceNotice } from "../../src/shared/library/LibraryTypes.js";
import type { TextSelection } from "../../src/shared/text/TextSelection.js";

// Library summary available from the empty startup workspace.
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

// Full text opened when Dream creation begins.
const libraryText: TextDocument = {
	...summary,
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "PerseusDL", commit: "test", sourceFile: "republic.xml", license: "CC" },
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "κατέβην" },
		{
			key: "s2",
			citation: { system: "stephanus", value: "327b" },
			text: "πρὸς τὸν Πειραιᾶ",
			annotations: [
				{ kind: "quotation", start: 0, end: 4 },
				{ kind: "citation", start: 4, end: 16 }
			]
		},
		{ key: "s3", citation: { system: "stephanus", value: "327c" }, text: "μετὰ Γλαύκωνος" }
	]
};

// Source attribution returned with the startup text.
const sourceNotice: SourceNotice = {
	source: "PerseusDL",
	editor: null,
	editionTitle: null,
	repository: "PerseusDL",
	license: "CC"
};

describe("DocumentPanel startup", function DocumentPanelStartupTests()
{
	let panel: DocumentPanel;
	let root: HTMLElement;
	let events: ChoraEventBus<ChoraEvents>;
	let controller: LibraryController;
	let activeDreamSource: TextSelection | null;

	beforeEach(async function SetupAsync()
	{
		root = document.createElement("div");
		document.body.append(root);
		events = new ChoraEventBus<ChoraEvents>();
		activeDreamSource = null;
		const errors = new ErrorManager(events);
		const store = new LibraryStore();
		vi.stubGlobal("window", {
			...window,
			chora: {
				ListLibraryTexts: vi.fn(async function ListLibraryTexts(): Promise<LibraryTextSummary[]> { return [summary]; }),
				LoadLibraryText: vi.fn(async function LoadLibraryText(): Promise<TextDocument> { return libraryText; }),
				GetSourceNotice: vi.fn(async function GetSourceNotice(): Promise<SourceNotice> { return sourceNotice; }),
				ShowSelectionContextMenu: vi.fn(async function ShowSelectionContextMenu(): Promise<null> { return null; })
			}
		});
		function GetActiveDreamSource(): TextSelection | null
		{
			return activeDreamSource;
		}
		controller = new LibraryController(events, errors, store, new LibraryGateway(), GetActiveDreamSource);
		panel = new DocumentPanel(root, events, store, controller, new ReadingSettingsStore());
		await controller.StartAsync();
	});

	afterEach(function Cleanup(): void
	{
		panel.Dispose();
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("renders the preferred text after Library startup", function RendersPreferredText()
	{
		expect(root.querySelector("#readingPane")).not.toBeNull();
		expect(root.textContent).toContain("κατέβην");
		expect(root.querySelector(".source-quotation")?.textContent).toBe("πρὸς τὸν Πειραιᾶ");
		expect(root.querySelector(".source-quotation-text")?.textContent).toBe("πρὸς");
		expect(root.querySelector(".source-quotation-citation")?.textContent).toBe(" τὸν Πειραιᾶ");
		expect(root.querySelector("[data-segment-key='s2'] .segment-text")?.textContent).toBe("πρὸς τὸν Πειραιᾶ");
	});

	it("loads a Signal source by its canonical exact range", async function LoadsSignalSourceAsync()
	{
		const segment = root.querySelector<HTMLElement>("[data-segment-key='s1']");
		const scroll = vi.fn();

		if (segment !== null)
		{
			segment.scrollIntoView = scroll;
		}

		await events.PublishAsync("library.jump-requested", {
			selection: {
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 7 }
			}
		});

		expect(segment?.querySelector(".signal-source-target")?.textContent).toBe("κατέβην");
		expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
	});

	it("highlights every segment covered by a Dream source passage", async function HighlightsCompletePassageAsync()
	{
		const first = root.querySelector<HTMLElement>("[data-segment-key='s1']");
		const scroll = vi.fn();
		if (first !== null) first.scrollIntoView = scroll;

		await events.PublishAsync("library.jump-requested", {
			selection: {
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s3", offset: libraryText.segments[2]?.text.length ?? 0 },
				selectedText: "κατέβην\nπρὸς τὸν Πειραιᾶ\nμετὰ Γλαύκωνος",
				locatorStart: { scheme: "Stephanus", value: "327a" },
				locatorEnd: { scheme: "Stephanus", value: "327c" }
			}
		});

		const highlighted = Array.from(root.querySelectorAll<HTMLElement>(".signal-source-target"));
		expect(highlighted.map(function GetText(target): string | null { return target.textContent; })).toEqual([
			"κατέβην",
			"πρὸς τὸν Πειραιᾶ",
			"μετὰ Γλαύκωνος"
		]);
		expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
	});

	it("highlights only the exact partial text at both Dream source boundaries", async function HighlightsExactBoundariesAsync()
	{
		const first = root.querySelector<HTMLElement>("[data-segment-key='s1']");
		const scroll = vi.fn();
		if (first !== null) first.scrollIntoView = scroll;

		await events.PublishAsync("library.jump-requested", {
			selection: {
				documentId: "republic",
				start: { segmentKey: "s1", offset: 2 },
				end: { segmentKey: "s3", offset: 4 },
				selectedText: "τέβην\nπρὸς τὸν Πειραιᾶ\nμετὰ",
				locatorStart: { scheme: "Stephanus", value: "327a" },
				locatorEnd: { scheme: "Stephanus", value: "327c" }
			}
		});

		const highlighted = Array.from(root.querySelectorAll<HTMLElement>(".signal-source-target"));
		expect(highlighted.map(function GetText(target): string | null { return target.textContent; })).toEqual([
			"τέβην",
			"πρὸς τὸν Πειραιᾶ",
			"μετὰ"
		]);
		expect(root.querySelector("[data-segment-key='s1'] .segment-text")?.textContent).toBe("κατέβην");
		expect(root.querySelector("[data-segment-key='s3'] .segment-text")?.textContent).toBe("μετὰ Γλαύκωνος");
		expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
	});

	it("retains the Dream source highlight when focusing one of its Signals", async function RetainsDreamHighlightAsync()
	{
		await events.PublishAsync("library.jump-requested", {
			selection: {
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s3", offset: libraryText.segments[2]?.text.length ?? 0 },
				selectedText: "κατέβην\nπρὸς τὸν Πειραιᾶ\nμετὰ Γλαύκωνος",
				locatorStart: { scheme: "Stephanus", value: "327a" },
				locatorEnd: { scheme: "Stephanus", value: "327c" }
			}
		});

		await events.PublishAsync("library.jump-requested", {
			target: "signal",
			selection: {
				documentId: "republic",
				start: { segmentKey: "s2", offset: 5 },
				end: { segmentKey: "s2", offset: 8 },
				selectedText: "τὸν",
				locatorStart: { scheme: "Stephanus", value: "327b" },
				locatorEnd: { scheme: "Stephanus", value: "327b" }
			}
		});

		const sourceHighlights = Array.from(root.querySelectorAll<HTMLElement>(".signal-source-target"));
		expect(sourceHighlights.map(function GetText(target): string | null { return target.textContent; })).toEqual([
			"κατέβην",
			"πρὸς τὸν Πειραιᾶ",
			"μετὰ Γλαύκωνος"
		]);
		expect(root.querySelector<HTMLElement>(".signal-focus-target")?.textContent).toBe("τὸν");
	});

	it("highlights every non-contiguous component of one Signal", async function HighlightsMultipartSignalAsync()
	{
		const first = root.querySelector<HTMLElement>("[data-segment-key='s1']");
		const secondText = libraryText.segments[1]?.text ?? "";
		const secondStart = secondText.indexOf("Πειραιᾶ");
		const scroll = vi.fn();
		if (first !== null) first.scrollIntoView = scroll;

		await events.PublishAsync("library.jump-requested", {
			target: "signal",
			selections: [
				{
					documentId: "republic",
					start: { segmentKey: "s1", offset: 0 },
					end: { segmentKey: "s1", offset: 3 }
				},
				{
					documentId: "republic",
					start: { segmentKey: "s2", offset: secondStart },
					end: { segmentKey: "s2", offset: secondStart + "Πειραιᾶ".length }
				}
			]
		});

		const highlighted = Array.from(root.querySelectorAll<HTMLElement>(".signal-focus-target"));
		expect(highlighted.map((target) => target.textContent)).toEqual(["κατ", "Πειραιᾶ"]);
		expect(scroll).toHaveBeenCalledOnce();
	});

	it("removes a deleted Signal passage highlight while retaining the remaining passage", async function ReconcilesRemovedPassageHighlightAsync()
	{
		const secondText = libraryText.segments[1]?.text ?? "";
		const secondStart = secondText.indexOf("Πειραιᾶ");
		const first = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 3 }
		};
		const second = {
			documentId: "republic",
			start: { segmentKey: "s2", offset: secondStart },
			end: { segmentKey: "s2", offset: secondStart + "Πειραιᾶ".length }
		};

		await events.PublishAsync("library.jump-requested", {
			target: "signal",
			selections: [first, second]
		});
		await events.PublishAsync("library.jump-requested", {
			target: "signal",
			selections: [second]
		});

		const highlighted = Array.from(root.querySelectorAll<HTMLElement>(".signal-focus-target"));
		expect(highlighted.map(function GetText(target): string | null { return target.textContent; })).toEqual(["Πειραιᾶ"]);
		expect(root.querySelector("[data-segment-key='s1'] .signal-focus-target")).toBeNull();
	});

	it("adds selected text to the active Signal through the reader menu", async function AddsToCurrentSignalAsync()
	{
		const selection = {
			documentId: "republic",
			start: { segmentKey: "s2", offset: 0 },
			end: { segmentKey: "s2", offset: 4 }
		};
		const menu = vi.mocked(window.chora.ShowSelectionContextMenu);
		menu.mockResolvedValue("add-to-selected-signal");
		let request: ChoraEvents["signal.selection-add-requested"] | null = null;
		events.Subscribe("signal.selection-add-requested", function CaptureRequest(event): void
		{
			request = event;
		});
		await events.PublishAsync("workspace.document-selected", { kind: "idea" });
		await events.PublishAsync("signal.active-changed", {
			signalId: "signal-1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 3 }
			}]
		});

		await controller.HandleSelectionActionAsync(selection);

		expect(menu).toHaveBeenCalledWith(true, false, true);
		expect(request).toEqual({ signalId: "signal-1", selection });
	});

	it("retains an automatically selected Signal when its Dream becomes active", async function RetainsAutoSelectedSignalAsync()
	{
		const selection = {
			documentId: "republic",
			start: { segmentKey: "s2", offset: 0 },
			end: { segmentKey: "s2", offset: 4 }
		};
		const menu = vi.mocked(window.chora.ShowSelectionContextMenu);
		menu.mockResolvedValue("add-to-selected-signal");
		let request: ChoraEvents["signal.selection-add-requested"] | null = null;
		events.Subscribe("signal.selection-add-requested", function CaptureRequest(event): void
		{
			request = event;
		});

		await events.PublishAsync("signal.active-changed", {
			signalId: "signal-1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 3 }
			}]
		});
		await events.PublishAsync("workspace.document-selected", { kind: "dream" });
		activeDreamSource = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s2", offset: 4 }
		};

		await controller.HandleSelectionActionAsync(selection);

		expect(menu).toHaveBeenCalledWith(true, false, true);
		expect(request).toEqual({ signalId: "signal-1", selection });
	});

	it("disables Dream Signal actions outside the active source passage", async function RejectsSignalOutsideDreamSourceAsync()
	{
		const selection = {
			documentId: "republic",
			start: { segmentKey: "s2", offset: 0 },
			end: { segmentKey: "s2", offset: 4 }
		};
		const menu = vi.mocked(window.chora.ShowSelectionContextMenu);
		menu.mockResolvedValue("add-to-selected-signal");
		let request: ChoraEvents["signal.selection-add-requested"] | null = null;
		events.Subscribe("signal.selection-add-requested", function CaptureRequest(event): void
		{
			request = event;
		});
		activeDreamSource = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 3 }
		};
		await events.PublishAsync("workspace.document-selected", { kind: "dream" });
		await events.PublishAsync("signal.active-changed", {
			signalId: "signal-1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 2 }
			}]
		});

		await controller.HandleSelectionActionAsync(selection);

		expect(menu).toHaveBeenCalledWith(false, false, false);
		expect(request).toBeNull();
	});

	it("disables adding text already contained by the selected Signal", async function RejectsDuplicateComponentAsync()
	{
		const selection = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 1 },
			end: { segmentKey: "s1", offset: 2 }
		};
		const menu = vi.mocked(window.chora.ShowSelectionContextMenu);
		await events.PublishAsync("workspace.document-selected", { kind: "dream" });
		await events.PublishAsync("signal.active-changed", {
			signalId: "signal-1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 3 }
			}]
		});

		await controller.HandleSelectionActionAsync(selection);

		expect(menu).toHaveBeenCalledWith(false, false, false);
	});

	it("enables Dream source extension only for an adjacent selection", async function ChecksDreamSourceAdjacencyAsync()
	{
		activeDreamSource = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 1 },
			end: { segmentKey: "s1", offset: 3 }
		};
		const adjacent = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 3 },
			end: { segmentKey: "s1", offset: 5 }
		};
		const separated = {
			documentId: "republic",
			start: { segmentKey: "s3", offset: 0 },
			end: { segmentKey: "s3", offset: 2 }
		};
		const segmentBoundary = {
			documentId: "republic",
			start: { segmentKey: "s2", offset: 0 },
			end: { segmentKey: "s2", offset: 2 }
		};
		const menu = vi.mocked(window.chora.ShowSelectionContextMenu);
		await events.PublishAsync("workspace.document-selected", { kind: "dream" });

		await controller.HandleSelectionActionAsync(adjacent);
		await controller.HandleSelectionActionAsync(separated);
		activeDreamSource = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 1 },
			end: { segmentKey: "s1", offset: libraryText.segments[0]?.text.length ?? 0 }
		};
		await controller.HandleSelectionActionAsync(segmentBoundary);

		expect(menu).toHaveBeenNthCalledWith(1, false, true, false);
		expect(menu).toHaveBeenNthCalledWith(2, false, false, false);
		expect(menu).toHaveBeenNthCalledWith(3, false, true, false);
	});
});
