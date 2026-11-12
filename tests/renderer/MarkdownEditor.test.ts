// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "../../src/renderer/ui/MarkdownEditor.js";
import { MarkdownEditorGateway } from "../../src/renderer/ui/MarkdownEditorGateway.js";
import { EditorView } from "@milkdown/kit/prose/view";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { SerializeVisionReferenceClipboardHtml, SerializeVisionReferenceDrag, VisionReferenceDragMime, type VisionReferenceDragPayload, type VisionReferencePlacement } from "../../src/shared/visions/VisionReferenceTypes.js";
import { ConcealVisionReferences, SerializeVisionReference } from "../../src/shared/visions/VisionReferenceMarkdown.js";

// Mounted editors are disposed even when an assertion fails.
const editors: MarkdownEditor[] = [];

// Mounts the actual Milkdown wrapper with a tracked change callback.
async function CreateEditorAsync(markdown: string, change = vi.fn(), readOnly = false, toolbarMode: "hidden" | "full" = "hidden", enableVisionReferences = false, onVisionReferenceAction?: ConstructorParameters<typeof MarkdownEditor>[9], onVisionSelectionDrop?: ConstructorParameters<typeof MarkdownEditor>[10]): Promise<MarkdownEditor>
{
	const events = new ChoraEventBus<ChoraEvents>();
	const errors = new ErrorManager(events);
	const editor = new MarkdownEditor(markdown, "Test description", change, errors, readOnly, "", null, toolbarMode, enableVisionReferences, onVisionReferenceAction, onVisionSelectionDrop);
	editors.push(editor);
	document.body.append(editor.Root);
	await editor.Ready;
	return editor;
}

// Selects the document through the browser selection interface.
function SelectContent(editor: MarkdownEditor): void
{
	const content = editor.Root.querySelector<HTMLElement>("[contenteditable=true]")!;
	content.focus();
	const range = document.createRange();
	range.selectNodeContents(content);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
}

afterEach(async function CleanupAsync()
{
	for (const editor of editors) editor.Dispose();
	editors.length = 0;
	await Promise.resolve();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("MarkdownEditor", function MarkdownEditorTests()
{
	it("renders read-only Markdown safely and updates without publishing edits", async function RendersReadOnlyAsync()
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync('[unsafe](javascript:alert%281%29)\n\n![remote](https://example.com/tracker.png)\n\n<script>alert(1)</script>', change, true);
		expect(editor.Root.querySelector('[contenteditable="true"]')).toBeNull();
		expect(editor.Root.querySelector('[role="document"]')).not.toBeNull();
		expect(editor.Root.querySelector<HTMLElement>(".markdown-toolbar")!.hidden).toBe(true);
		expect(editor.Root.querySelector('img,script,iframe,a[href^="javascript:"]')).toBeNull();
		editor.SetMarkdown("# Updated Vision\n\n**New observation**");
		expect(editor.Root.querySelector("strong")?.textContent).toBe("New observation");
		expect(change).not.toHaveBeenCalled();

		// A divider needs a paragraph boundary; otherwise Markdown treats the block as a setext heading.
		editor.SetMarkdown("Measurement of the Logos\\\n\\\nA question about the telling of a story.\n\n---\n\nAfter the divider.");
		expect(editor.Root.querySelector("h1,h2,h3,h4")).toBeNull();
		expect(editor.Root.querySelector("hr")).not.toBeNull();
		expect(editor.Root.querySelector("p")?.textContent).toContain("Measurement of the Logos");

		// Repeated hard-break paragraphs must not become one section-sized setext heading.
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"a".repeat(64)}`,
			presentation: "inline-word",
			label: "λόγος"
		};
		const directive = SerializeVisionReference(placement);
		const code = "literal\\\n\\\nunchanged";
		const malformed = `\\\nBefore.\n\n## Scene\n\n\\\n\\\nMeasurement of the Logos\\\n\\\n**Question** ${directive}\\\nSecond line.\\\n\\\n&#x20;  Body after.\n${"-".repeat(120)}\n\n***\n\n\`\`\`text\n${code}\n\`\`\``;
		const vision = await CreateEditorAsync(malformed, change, true, "full", true);
		const headings = Array.from(vision.Root.querySelectorAll("h2"), function Heading(node): string | null
		{
			return node.textContent;
		});
		expect(headings).toEqual(["Scene", "Measurement of the Logos"]);
		expect(vision.Root.querySelector("strong")?.textContent).toBe("Question");
		expect(vision.Root.querySelector("h2 [data-vision-reference]")).toBeNull();
		expect(vision.Root.querySelector("p [data-vision-reference]")?.textContent).toBe("λόγος");
		expect(vision.Root.querySelector("pre code")?.textContent).toBe(code);
		expect(vision.GetMarkdown()).toContain("## Measurement of the Logos\n\n**Question**");
		expect(vision.GetMarkdown()).toContain(directive);
		expect(vision.GetMarkdown()).not.toContain("&#x20;");
		expect(change).not.toHaveBeenCalled();
		const reopened = await CreateEditorAsync(vision.GetMarkdown(), vi.fn(), true, "full", true);
		expect(reopened.Root.querySelectorAll("h2")).toHaveLength(2);
		expect(reopened.GetMarkdown()).toBe(vision.GetMarkdown());
	});

	it("uses the context menu instead of a permanent toolbar for editable Markdown", async function HidesEditableToolbarAsync()
	{
		const editor = await CreateEditorAsync("Editable");

		expect(editor.Root.querySelector<HTMLElement>(".markdown-toolbar")?.hidden).toBe(true);
		expect(editor.Root.querySelector<HTMLElement>("[contenteditable=true]")).not.toBeNull();
	});

	it("renders GFM and exposes the full Vision formatting toolbar", async function RendersVisionGfmAsync(): Promise<void>
	{
		const markdown = "~~memory~~\n\n- [ ] Return\n\n| Word | Note |\n| --- | --- |\n| λόγος | relation |";
		const editor = await CreateEditorAsync(markdown, vi.fn(), false, "full");

		expect(editor.Root.querySelector<HTMLElement>(".markdown-toolbar")?.hidden).toBe(false);
		expect(editor.Root.querySelector("del")?.textContent).toBe("memory");
		expect(editor.Root.querySelector("table")).not.toBeNull();
		expect(editor.Root.querySelector("li[data-checked]")).not.toBeNull();
		const heading = editor.Root.querySelector<HTMLSelectElement>("[data-markdown-heading]")!;
		expect(Array.from(heading.options).map((option) => option.textContent)).toEqual([
			"Normal",
			"Heading 1",
			"Heading 2",
			"Heading 3",
			"Heading 4"
		]);
		expect(editor.Root.querySelector('[data-markdown-command="heading_1"]')).toBeNull();
		expect(editor.Root.querySelector('[data-markdown-command="task_list"]')).not.toBeNull();
		expect(editor.Root.querySelector('[data-markdown-command="table"]')).not.toBeNull();
		expect(editor.GetMarkdown()).toBe(markdown);
	});

	it("applies Heading 1 through Heading 4 and returns to normal text", async function AppliesHeadingStylesAsync(): Promise<void>
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync("Title", change, false, "full", true);
		SelectContent(editor);
		const heading = editor.Root.querySelector<HTMLSelectElement>("[data-markdown-heading]")!;

		heading.value = "1";
		heading.dispatchEvent(new Event("change", { bubbles: true }));
		expect(editor.Root.querySelector("h1")?.textContent).toBe("Title");
		expect(editor.GetMarkdown().trim()).toBe("# Title");

		heading.value = "4";
		heading.dispatchEvent(new Event("change", { bubbles: true }));
		expect(editor.Root.querySelector("h4")?.textContent).toBe("Title");
		expect(editor.GetMarkdown().trim()).toBe("#### Title");

		heading.value = "paragraph";
		heading.dispatchEvent(new Event("change", { bubbles: true }));
		expect(editor.Root.querySelector("p")?.textContent).toBe("Title");
		expect(editor.GetMarkdown().trim()).toBe("Title");

		// A selected title within hard-break prose becomes its own heading, preserving exact evidence.
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"a".repeat(64)}`,
			presentation: "inline-word",
			label: "λόγος"
		};
		const directive = SerializeVisionReference(placement);
		const markdown = `Before the title\\\n\\\nMeasurement of the Logos\\\n\\\nAfter **the title** ${directive}\\\nStill normal prose.`;
		editor.SetMarkdown(markdown);
		const content = editor.Root.querySelector<HTMLElement>("[contenteditable=true]")!;
		const paragraph = Array.from(content.querySelectorAll("p")).find(function FindTitleParagraph(candidate): boolean
		{
			const matches = candidate.textContent === "Measurement of the Logos";
			return matches;
		})!;
		const title = Array.from(paragraph.childNodes).find(function FindTitle(node): boolean
		{
			const matches = node.nodeType === Node.TEXT_NODE && node.textContent === "Measurement of the Logos";
			return matches;
		})!;
		content.focus();
		const range = document.createRange();
		range.selectNodeContents(title);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
		heading.focus();
		heading.value = "2";
		heading.dispatchEvent(new Event("change", { bubbles: true }));
		expect(editor.Root.querySelectorAll("h2")).toHaveLength(1);
		expect(editor.Root.querySelector("h2")?.textContent).toBe("Measurement of the Logos");
		expect(editor.GetMarkdown()).toContain("\n\n## Measurement of the Logos\n\n");
		expect(editor.GetMarkdown()).toContain(directive);
		expect(editor.Root.querySelector("strong")?.textContent).toBe("the title");
		expect(change).toHaveBeenLastCalledWith(editor.GetMarkdown());
		const reopened = await CreateEditorAsync(editor.GetMarkdown(), vi.fn(), true, "full", true);
		expect(reopened.Root.querySelector("h2")?.textContent).toBe("Measurement of the Logos");
		expect(reopened.Root.querySelector("h2 [data-vision-reference]")).toBeNull();
		expect(reopened.Root.querySelector("p [data-vision-reference]")?.textContent).toBe("λόγος");
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="undo"]')!.click();
		expect(editor.Root.querySelector("h2")).toBeNull();
		expect(editor.Root.querySelectorAll(".ProseMirror > p")).toHaveLength(3);
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="redo"]')!.click();
		expect(editor.Root.querySelector("h2")?.textContent).toBe("Measurement of the Logos");
	});

	it("inserts and round-trips an atomic Vision word reference", async function InsertsVisionWordReferenceAsync(): Promise<void>
	{
		const change = vi.fn();
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"a".repeat(64)}`,
			presentation: "inline-word",
			label: "κατέβην"
		};
		const editor = await CreateEditorAsync("Before after", change, false, "full", true);

		editor.InsertVisionReference(placement);

		const directive = SerializeVisionReference(placement);
		expect(editor.GetMarkdown()).toContain(directive);
		expect(change).toHaveBeenCalled();
		const reference = editor.Root.querySelector<HTMLElement>("[data-vision-reference]");
		expect(reference?.textContent).toBe("κατέβην");
		expect(reference?.dataset.anchorId).toBe(placement.anchorId);
		expect(reference?.getAttribute("contenteditable")).toBe("false");
		editor.FocusVisionReference(placement.id);
		expect(reference?.classList.contains("ProseMirror-selectednode")).toBe(true);

		const reopened = await CreateEditorAsync(`Earlier ${directive} later`, vi.fn(), true, "hidden", true);
		const restored = reopened.Root.querySelector<HTMLElement>("[data-vision-reference]");
		expect(restored?.dataset.placementId).toBe(placement.id);
		expect(restored?.dataset.anchorId).toBe(placement.anchorId);
		expect(reopened.GetMarkdown()).toBe(`Earlier ${directive} later`);
	});

	it("offers exact Vision word reference actions", async function OpensVisionReferenceMenuAsync(): Promise<void>
	{
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"a".repeat(64)}`,
			presentation: "inline-word",
			label: "κατέβην"
		};
		const action = vi.fn().mockResolvedValue(undefined);
		const menu = vi.spyOn(MarkdownEditorGateway.prototype, "ShowVisionReferenceMenuAsync")
			.mockResolvedValueOnce("navigate")
			.mockResolvedValueOnce("copy");
		const copy = vi.spyOn(MarkdownEditorGateway.prototype, "CopyTextAsync").mockResolvedValue();
		const editor = await CreateEditorAsync(SerializeVisionReference(placement), vi.fn(), false, "full", true, action);
		const reference = editor.Root.querySelector<HTMLElement>("[data-vision-reference]")!;

		reference.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		await vi.waitFor(() => expect(action).toHaveBeenCalledWith(placement, "navigate"));
		reference.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("κατέβην"));
		expect(menu).toHaveBeenCalledTimes(2);
		expect(menu).toHaveBeenCalledWith(true);
		action.mockClear();
		reference.click();
		await vi.waitFor(() => expect(action).toHaveBeenCalledWith(placement, "explore-word"));
	});

	it("round-trips an exact multi-line Vision range reference", async function InsertsVisionRangeReferenceAsync(): Promise<void>
	{
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174003",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"c".repeat(64)}`,
			presentation: "inline-range",
			label: "κατέβην | πρὸς\nτὸν Πειραιᾶ"
		};
		const action = vi.fn().mockResolvedValue(undefined);
		const menu = vi.spyOn(MarkdownEditorGateway.prototype, "ShowVisionReferenceMenuAsync").mockResolvedValue("navigate");
		const editor = await CreateEditorAsync("Before after", vi.fn(), false, "full", true, action);

		editor.InsertVisionReference(placement);

		const directive = SerializeVisionReference(placement);
		expect(directive).toContain("{{chora-range|");
		expect(directive).not.toContain(placement.label);
		expect(ConcealVisionReferences(directive)).toBe(`[[${placement.label}]]`);
		expect(editor.GetMarkdown()).toContain(directive);
		const reference = editor.Root.querySelector<HTMLElement>('[data-vision-reference="inline-range"]');
		expect(reference?.textContent).toBe(placement.label);
		reference?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		await vi.waitFor(() => expect(action).toHaveBeenCalledWith(placement, "navigate"));
		expect(menu).toHaveBeenCalledWith(false);

		const reopened = await CreateEditorAsync(`Earlier ${directive} later`, vi.fn(), true, "hidden", true);
		expect(reopened.Root.querySelector('[data-vision-reference="inline-range"]')?.textContent).toBe(placement.label);
		expect(reopened.GetMarkdown()).toBe(`Earlier ${directive} later`);
	});

	it("opens one clicked Greek word inside a locked range reference", async function OpensClickedRangeWordAsync(): Promise<void>
	{
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174005",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"e".repeat(64)}`,
			presentation: "inline-range",
			label: "κατέβην πρὸς"
		};
		const action = vi.fn().mockResolvedValue(undefined);
		const editor = await CreateEditorAsync(SerializeVisionReference(placement), vi.fn(), false, "full", true, action);
		const word = editor.Root.querySelector<HTMLElement>('[data-vision-range-word][data-word-start="8"]')!;

		word.click();

		await vi.waitFor(() =>
		{
			expect(action).toHaveBeenCalledWith(placement, "explore-word", { start: 8, end: 12 });
		});
		expect(word.textContent).toBe("πρὸς");
	});

	it("inserts a dragged exact reader selection at the Vision drop point", async function DropsVisionRangeReferenceAsync(): Promise<void>
	{
		const payload: VisionReferenceDragPayload = {
			selection: {
				dialogue: "republic",
				text_version: `sha256:${"0".repeat(64)}`,
				start: { stephanus: "327a", offset: 0 },
				end: { stephanus: "327a", offset: 12 }
			},
			anchorKind: "phrase"
		};
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174004",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"d".repeat(64)}`,
			presentation: "inline-range",
			label: "κατέβην πρὸς"
		};
		let editor: MarkdownEditor;
		const drop = vi.fn(async (_payload: VisionReferenceDragPayload, requestId: string): Promise<void> =>
		{
			editor.InsertVisionReference(placement, requestId);
		});
		editor = await CreateEditorAsync("Before after", vi.fn(), false, "full", true, undefined, drop);
		const transfer = new DataTransfer();
		transfer.setData(VisionReferenceDragMime, SerializeVisionReferenceDrag(payload));
		const dropEvent = new DragEvent("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(dropEvent, "dataTransfer", { value: transfer });

		editor.Root.querySelector<HTMLElement>(".markdown-content")?.dispatchEvent(dropEvent);

		await vi.waitFor(() => expect(drop).toHaveBeenCalledWith(payload, expect.any(String)));
		expect(editor.GetMarkdown()).toContain(SerializeVisionReference(placement));
		expect(editor.Root.querySelector('[data-vision-reference="inline-range"]')?.textContent).toBe(placement.label);
	});

	it("pastes a copied reader anchor through the existing Vision insertion workflow", async function PastesVisionRangeReferenceAsync(): Promise<void>
	{
		const payload: VisionReferenceDragPayload = {
			selection: {
				dialogue: "republic",
				text_version: `sha256:${"0".repeat(64)}`,
				start: { stephanus: "327a", offset: 0 },
				end: { stephanus: "327a", offset: 12 }
			},
			anchorKind: "phrase"
		};
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174005",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: `anchor:sha256:${"e".repeat(64)}`,
			presentation: "inline-range",
			label: "κατέβην πρὸς"
		};
		let editor: MarkdownEditor;
		const insert = vi.fn(async (_payload: VisionReferenceDragPayload, requestId: string): Promise<void> =>
		{
			editor.InsertVisionReference(placement, requestId);
		});
		editor = await CreateEditorAsync("Replace me", vi.fn(), false, "full", true, undefined, insert);
		SelectContent(editor);
		const clipboard = new DataTransfer();
		clipboard.setData("text/html", SerializeVisionReferenceClipboardHtml(payload, placement.label));
		clipboard.setData("text/plain", placement.label);
		const paste = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true });
		const fallbackPaste = vi.fn();
		editor.Root.querySelector<HTMLElement>(".markdown-content")!.addEventListener("paste", fallbackPaste);

		editor.Root.querySelector<HTMLElement>("[contenteditable=true]")!.dispatchEvent(paste);

		await vi.waitFor(() => expect(insert).toHaveBeenCalledWith(payload, expect.any(String)));
		expect(paste.defaultPrevented).toBe(true);
		expect(fallbackPaste).not.toHaveBeenCalled();
		expect(editor.Root.querySelectorAll("[data-vision-reference]")).toHaveLength(1);
		expect(editor.Root.querySelector('[data-vision-reference="inline-range"]')?.textContent).toBe(placement.label);
	});

	it("replaces external content without publishing changes or retaining stale undo history", async function ReplacesDocumentAsync()
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync("Original", change);
		SelectContent(editor);
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="bold"]')!.click();
		change.mockClear();
		editor.SetMarkdown("Replacement");
		expect(editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="undo"]')!.disabled).toBe(true);
		expect(editor.GetMarkdown()).toBe("Replacement");
		expect(change).not.toHaveBeenCalled();
	});

	it("does not rebuild the document or collapse selection for equivalent external content", async function PreservesSelectionAsync()
	{
		const editor = await CreateEditorAsync("Selected observation");
		SelectContent(editor);
		const selection = window.getSelection();
		const selectedText = selection?.toString();
		editor.SetMarkdown(editor.GetMarkdown());
		expect(window.getSelection()).toBe(selection);
		expect(window.getSelection()?.toString()).toBe(selectedText);
	});

	it("renders Greek and formatting without rewriting the original Markdown on initialization", async function RendersMarkdownAsync()
	{
		const change = vi.fn();
		const markdown = "**κατέβην** and *memory*\n\n> A quotation\n\n- First\n- Second";
		const editor = await CreateEditorAsync(markdown, change);
		expect(editor.Root.querySelector("strong")?.textContent).toBe("κατέβην");
		expect(editor.Root.querySelector("em")?.textContent).toBe("memory");
		expect(editor.Root.querySelectorAll("li")).toHaveLength(2);
		expect(editor.GetMarkdown()).toBe(markdown);
		expect(change).not.toHaveBeenCalled();
		expect(editor.Root.querySelector("[role=textbox]")?.getAttribute("aria-label")).toBe("Test description");
	});

	it("focuses the editable document when its blank writing surface is clicked", async function FocusesFromBlankSurfaceAsync()
	{
		const editor = await CreateEditorAsync("A short observation.");
		const surface = editor.Root.querySelector<HTMLElement>(".markdown-content")!;
		const content = editor.Root.querySelector<HTMLElement>("[contenteditable=true]")!;

		surface.click();

		expect(document.activeElement).toBe(content);
	});

	it("preserves selected text when a drag ends on the blank writing surface", async function PreservesReverseDragSelectionAsync()
	{
		const editor = await CreateEditorAsync("A selected observation.");
		const surface = editor.Root.querySelector<HTMLElement>(".markdown-content")!;
		SelectContent(editor);
		const selectedText = window.getSelection()?.toString();

		surface.click();

		expect(window.getSelection()?.toString()).toBe(selectedText);
	});

	it("formats a selection and publishes Markdown synchronously with undo support", async function FormatsAndUndoesAsync()
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync("κατέβην", change);
		SelectContent(editor);
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="bold"]')!.click();
		expect(editor.Root.querySelector("strong")?.textContent).toBe("κατέβην");
		expect(change).toHaveBeenCalled();
		expect(editor.GetMarkdown()).toContain("**κατέβην**");
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="undo"]')!.click();
		expect(editor.Root.querySelector("strong")).toBeNull();
		expect(editor.GetMarkdown().trim()).toBe("κατέβην");
	});

	it.each(["bold", "italic"] as const)("formats a right-clicked word with %s", async function FormatsContextWordAsync(command)
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync("κατέβην yesterday", change);
		vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue({ pos: 3, inside: 0 });
		const menu = vi.spyOn(MarkdownEditorGateway.prototype, "ShowFormattingMenuAsync").mockResolvedValue(command);
		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
		editor.Root.querySelector("[contenteditable=true]")!.dispatchEvent(event);
		await vi.waitFor(function Formatted(): void
		{
			const selector = command === "bold" ? "strong" : "em";
			expect(editor.Root.querySelector(selector)?.textContent).toBe("κατέβην");
		});
		expect(event.defaultPrevented).toBe(false);
		expect(menu).toHaveBeenCalledOnce();
		expect(change).toHaveBeenCalled();
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="undo"]')!.click();
		expect(editor.GetMarkdown().trim()).toBe("κατέβην yesterday");
	});

	it("preserves a selected phrase when right-clicking inside it", async function PreservesContextSelectionAsync()
	{
		const editor = await CreateEditorAsync("κατέβην yesterday");
		SelectContent(editor);
		vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue({ pos: 3, inside: 0 });
		vi.spyOn(MarkdownEditorGateway.prototype, "ShowFormattingMenuAsync").mockResolvedValue("bold");
		editor.Root.querySelector("[contenteditable=true]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await vi.waitFor(function EntireSelectionFormatted(): void
		{
			expect(editor.Root.querySelector("strong")?.textContent).toBe("κατέβην yesterday");
		});
	});

	it("leaves text untouched when the context menu is dismissed", async function CancelsContextMenuAsync()
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync("Original text", change);
		vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue({ pos: 3, inside: 0 });
		vi.spyOn(MarkdownEditorGateway.prototype, "ShowFormattingMenuAsync").mockResolvedValue(null);
		editor.Root.querySelector("[contenteditable=true]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		await Promise.resolve();
		expect(editor.GetMarkdown()).toBe("Original text");
		expect(change).not.toHaveBeenCalled();
	});

	it("renders unsafe links inertly without image or executable HTML elements", async function NeutralizesUnsafeContentAsync()
	{
		const editor = await CreateEditorAsync('[unsafe](javascript:alert%281%29)\n\n![remote](https://example.com/tracker.png)\n\n<script>alert(1)</script>');
		expect(editor.Root.querySelector('a[href^="javascript:"]')).toBeNull();
		expect(editor.Root.querySelector("img,script,iframe")).toBeNull();
		expect(MarkdownEditor.IsSafeLink("javascript:alert(1)")).toBe(false);
		expect(MarkdownEditor.IsSafeLink("file:///C:/secret")).toBe(false);
		expect(MarkdownEditor.IsSafeLink("https://example.com")).toBe(true);
	});

	it.each(["bullet_list", "ordered_list", "blockquote"])("toggles %s on and off", async function TogglesBlocksAsync(command: string)
	{
		const editor = await CreateEditorAsync("An observation");
		SelectContent(editor);
		const button = editor.Root.querySelector<HTMLButtonElement>(`[data-markdown-command="${command}"]`)!;
		button.click();
		const selector = command === "bullet_list" ? "ul" : command === "ordered_list" ? "ol" : "blockquote";
		expect(editor.Root.querySelector(selector)).not.toBeNull();
		button.click();
		expect(editor.Root.querySelector(selector)).toBeNull();
		expect(editor.GetMarkdown().trim()).toBe("An observation");
	});

	it("creates and removes a safe link without losing the selected Greek text", async function EditsLinksAsync()
	{
		const editor = await CreateEditorAsync("κατέβην");
		SelectContent(editor);
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="link"]')!.click();
		const input = editor.Root.querySelector<HTMLInputElement>("input")!;
		input.value = "https://example.com";
		editor.Root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(editor.GetMarkdown()).toContain("[κατέβην](https://example.com)");
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="unlink"]')!.click();
		expect(editor.Root.querySelector("a")).toBeNull();
		expect(editor.GetMarkdown().trim()).toBe("κατέβην");
	});

	it("disposes safely before asynchronous initialization completes", async function DisposesEarlyAsync()
	{
		const change = vi.fn();
		const events = new ChoraEventBus<ChoraEvents>();
		const editor = new MarkdownEditor("Original", "Early close", change, new ErrorManager(events));
		document.body.append(editor.Root);
		editor.Dispose();
		await editor.Ready;
		expect(editor.Root.isConnected).toBe(false);
		expect(change).not.toHaveBeenCalled();
	});

	it("preserves Greek text pasted through the clipboard", async function PastesGreekAsync()
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync("Original", change, false, "full", true);
		SelectContent(editor);
		const clipboard = new DataTransfer();
		clipboard.setData("text/plain", "κατέβην χθὲς");
		const event = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true });
		editor.Root.querySelector("[contenteditable=true]")!.dispatchEvent(event);
		expect(editor.GetMarkdown().trim()).toBe("κατέβην χθὲς");
		expect(change).toHaveBeenCalled();
		SelectContent(editor);
		const richClipboard = new DataTransfer();
		richClipboard.setData("text/html", "<p>κατέβην<br><br>χθὲς <strong>bold</strong></p>");
		richClipboard.setData("text/plain", "κατέβην\n\nχθὲς bold");
		const richPaste = new ClipboardEvent("paste", { clipboardData: richClipboard, bubbles: true, cancelable: true });
		editor.Root.querySelector<HTMLElement>("[contenteditable=true]")!.dispatchEvent(richPaste);
		expect(editor.GetMarkdown().trim()).toBe("κατέβην\n\nχθὲς **bold**");
		expect(editor.Root.querySelectorAll(".ProseMirror > p")).toHaveLength(2);
		expect(editor.Root.querySelector("strong")?.textContent).toBe("bold");
	});
});
