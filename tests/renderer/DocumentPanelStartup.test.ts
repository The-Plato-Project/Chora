// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationResult } from "../../src/shared/diagnostics/OperationResult.js";
import type { TextDocument, LibraryTextSummary, SourceNotice } from "../../src/shared/library/LibraryTypes.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { DocumentPanel } from "../../src/renderer/library/DocumentPanel.js";
import { LibraryController } from "../../src/renderer/library/LibraryController.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { DecodeVisionReferenceClipboardHtml, DecodeVisionReferenceDrag, VisionReferenceDragMime } from "../../src/shared/visions/VisionReferenceTypes.js";

const summary: LibraryTextSummary = {
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: null,
	author: "Plato",
	language: "grc",
	editor: null
};

const libraryText: TextDocument = {
	...summary,
	textVersion: `sha256:${"0".repeat(64)}`,
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

	beforeEach(async function SetupAsync()
	{
		root = document.createElement("div");
		document.body.append(root);
		events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new LibraryStore();
		vi.stubGlobal("window", {
			...window,
			getSelection: window.getSelection.bind(window),
			chora: {
				ListLibraryTexts: vi.fn(async function ListLibraryTexts(): Promise<OperationResult<LibraryTextSummary[]>> { return { ok: true, value: [summary] }; }),
				LoadLibraryText: vi.fn(async function LoadLibraryText(): Promise<OperationResult<TextDocument>> { return { ok: true, value: libraryText }; }),
				GetSourceNotice: vi.fn(async function GetSourceNotice(): Promise<OperationResult<SourceNotice>> { return { ok: true, value: sourceNotice }; }),
				ShowSelectionContextMenu: vi.fn(async function ShowSelectionContextMenu(): Promise<OperationResult<null>> { return { ok: true, value: null }; })
			}
		});
		const controller = new LibraryController(events, errors, store, new LibraryGateway(), { GetActive: () => null });
		panel = new DocumentPanel(root, events, store, controller);
		await controller.StartAsync();
	});

	afterEach(function Cleanup(): void
	{
		panel.Dispose();
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("renders the preferred text after Library startup", async function RendersPreferredText()
	{
		expect(root.querySelector("#readingPane")).not.toBeNull();
		expect(root.textContent).toContain("κατέβην");
		expect(root.querySelector(".source-quotation")?.textContent).toBe("πρὸς τὸν Πειραιᾶ");
		expect(root.querySelector(".source-quotation-text")?.textContent).toBe("πρὸς");
		expect(root.querySelector(".source-quotation-citation")?.textContent).toBe(" τὸν Πειραιᾶ");
		expect(root.querySelector(".reader-settings-menu")).toBeNull();
		expect(root.querySelector("[data-anchor-highlight-color]")).toBeNull();
		expect(root.querySelector("[data-find-input]")?.classList.contains("control-input")).toBe(true);
		await events.PublishAsync("library.position-restored", { segmentKey: "s1" });
		expect(root.querySelector(".source-focus-target")).toBeNull();
	});

	it("places the exact dragged reader selection in the Vision transfer payload", function CreatesVisionDragPayload(): void
	{
		const target = root.querySelector<HTMLElement>("[data-segment-key='s3'] .segment-text")!;
		const text = target.firstChild as Text;
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, text.data.length);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		const transfer = new DataTransfer();
		const drag = new DragEvent("dragstart", { bubbles: true });
		Object.defineProperty(drag, "dataTransfer", { value: transfer });

		target.dispatchEvent(drag);

		const payload = DecodeVisionReferenceDrag(transfer.getData(VisionReferenceDragMime));
		expect(payload.anchorKind).toBe("phrase");
		expect(payload.selection).toMatchObject({
			start: { stephanus: "s3", offset: 0 },
			end: { stephanus: "s3", offset: text.data.length }
		});
		expect(transfer.getData("text/plain")).toBe("μετὰ Γλαύκωνος");
	});

	it("copies an exact reader selection as an anchor with plain Greek fallback", function CopiesVisionAnchor(): void
	{
		const target = root.querySelector<HTMLElement>("[data-segment-key='s1'] .segment-text")!;
		const text = target.firstChild as Text;
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, text.data.length);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		const clipboard = new DataTransfer();
		const copy = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: clipboard });

		target.dispatchEvent(copy);

		expect(copy.defaultPrevented).toBe(true);
		const payload = DecodeVisionReferenceDrag(clipboard.getData(VisionReferenceDragMime));
		expect(payload.anchorKind).toBe("word");
		expect(DecodeVisionReferenceClipboardHtml(clipboard.getData("text/html"))).toEqual(payload);
		expect(clipboard.getData("text/plain")).toBe("κατέβην");
	});

	it("highlights one exact source range and scrolls it into view", async function HighlightsSourceAsync()
	{
		const segment = root.querySelector<HTMLElement>("[data-segment-key='s1']")!;
		segment.scrollIntoView = vi.fn();

		await events.PublishAsync("library.jump-requested", {
			selection: {
				dialogue: "republic",
				text_version: libraryText.textVersion,
				start: { stephanus: "s1", offset: 1 },
				end: { stephanus: "s1", offset: 5 }
			},
			target: "source"
		});

		expect(segment.querySelector(".source-focus-target")?.textContent).toBe("ατέβ");
		expect(segment.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
	});

	it("keeps persistent word occurrences separate from source navigation", async function PreservesWordHighlightsAsync()
	{
		const wordSelection = {
			dialogue: "republic",
			text_version: libraryText.textVersion,
			start: { stephanus: "s3", offset: 5 },
			end: { stephanus: "s3", offset: 14 }
		};
		await events.PublishAsync("word.highlights-changed", { selections: [wordSelection] });
		await events.PublishAsync("library.jump-requested", {
			selection: {
				dialogue: "republic",
				text_version: libraryText.textVersion,
				start: { stephanus: "s1", offset: 0 },
				end: { stephanus: "s1", offset: 7 }
			},
			target: "source"
		});

		expect(root.querySelector(".word-focus-target")?.textContent).toBe("Γλαύκωνος");
		expect(root.querySelector(".source-focus-target")?.textContent).toBe("κατέβην");
	});
});
