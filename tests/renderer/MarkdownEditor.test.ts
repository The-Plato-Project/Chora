// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "../../src/renderer/ui/MarkdownEditor.js";
import { MarkdownEditorGateway } from "../../src/renderer/ui/MarkdownEditorGateway.js";
import { EditorView } from "@milkdown/kit/prose/view";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ParseDreamMarkdown, SerializeDreamMarkdown } from "../../src/main/dreams/DreamMarkdownCodec.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import { SignalMarkdownDocument } from "../../src/shared/dreams/SignalMarkdownDocument.js";
import { SignalMarkdownCodec } from "../../src/main/signals/SignalMarkdownCodec.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Mounted editors are disposed even when an assertion fails.
const editors: MarkdownEditor[] = [];

// Mounts the actual Milkdown wrapper with a tracked change callback.
async function CreateEditorAsync(markdown: string, change = vi.fn(), readOnly = false): Promise<MarkdownEditor>
{
	const events = new ChoraEventBus<ChoraEvents>();
	const errors = new ErrorManager(events);
	const editor = new MarkdownEditor(markdown, "Test description", change, errors, readOnly);
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
	it("serializes a complete Signal", function SerializesSignalMarkdown()
	{
		const selection = { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 7 } };
		const dream: DreamView = {
			id: "dream", workId: "republic", dialogue: "Republic", title: "Descent",
			source: selection,
			signals: [{
				id: "signal",
				dreamId: "dream",
				workId: "republic",
				sourceRef: "s1",
				text: "κατέβην",
				selections: [selection],
				description: "An observation",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01"
			}],
			reflection: "A reflection", synopticView: "", linkedDreamIds: ["another"], createdAt: "2026-01-01", updatedAt: "2026-01-01"
		};
		const signal = dream.signals[0]!;
		const markdown = SignalMarkdownDocument.SerializeSection(dream, signal, 1);
		expect(markdown).toContain("# Signal");
		expect(markdown).toContain("> κατέβην");
		expect(markdown).toContain("Source: Republic · s1");
		expect(markdown).toContain("## Observation\n\nAn observation");
	});

	it("renders read-only Markdown safely and updates without publishing edits", async function RendersReadOnlyAsync()
	{
		const change = vi.fn();
		const editor = await CreateEditorAsync('[unsafe](javascript:alert%281%29)\n\n![remote](https://example.com/tracker.png)\n\n<script>alert(1)</script>', change, true);
		expect(editor.Root.querySelector('[contenteditable="true"]')).toBeNull();
		expect(editor.Root.querySelector('[role="document"]')).not.toBeNull();
		expect(editor.Root.querySelector<HTMLElement>(".markdown-toolbar")!.hidden).toBe(true);
		expect(editor.Root.querySelector('img,script,iframe,a[href^="javascript:"]')).toBeNull();
		editor.SetMarkdown("# Updated Dream\n\n**New observation**");
		expect(editor.Root.querySelector("strong")?.textContent).toBe("New observation");
		expect(change).not.toHaveBeenCalled();
	});

	it("uses the context menu instead of a permanent toolbar for editable Markdown", async function HidesEditableToolbarAsync()
	{
		const editor = await CreateEditorAsync("Editable");

		expect(editor.Root.querySelector<HTMLElement>(".markdown-toolbar")?.hidden).toBe(true);
		expect(editor.Root.querySelector<HTMLElement>("[contenteditable=true]")).not.toBeNull();
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

	it("round-trips formatted descriptions and Reflections through the existing Markdown file codec", async function PersistsMarkdownAsync()
	{
		const editor = await CreateEditorAsync("κατέβην");
		SelectContent(editor);
		editor.Root.querySelector<HTMLButtonElement>('[data-markdown-command="bold"]')!.click();
		const markdown = editor.GetMarkdown();
		const selection = { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 7 } };
		const dream: DreamView = {
			id: "formatted", workId: "republic", dialogue: "Republic", title: "Formatting",
			source: selection,

			signals: [{
				id: "one",
				dreamId: "formatted",
				workId: "republic",
				sourceRef: "s1",
				selections: [selection],
				text: "κατέβην",
				description: markdown,
				createdAt: "2026-09-06",
				updatedAt: "2026-09-06"
			}],
			reflection: markdown, synopticView: "", linkedDreamIds: [], createdAt: "2026-09-06", updatedAt: "2026-09-06"
		};
		const signal: SignalRecord = {
			...dream.signals[0]!,
			workId: dream.workId,
			createdAt: dream.createdAt,
			updatedAt: dream.updatedAt
		};
		const serialized = SerializeDreamMarkdown(dream);
		const restored = ParseDreamMarkdown(serialized)!;
		const signalCodec = new SignalMarkdownCodec();
		const restoredSignal = signalCodec.Parse(signalCodec.Serialize(signal));
		expect(restoredSignal.description).toBe(markdown.trim());
		expect(restored.reflection.trim()).toBe(markdown.trim());
		const reopened = await CreateEditorAsync(restored.reflection);
		expect(reopened.Root.querySelector("strong")?.textContent).toBe("κατέβην");
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
		const editor = await CreateEditorAsync("Original", change);
		SelectContent(editor);
		const clipboard = new DataTransfer();
		clipboard.setData("text/plain", "κατέβην χθὲς");
		const event = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true });
		editor.Root.querySelector("[contenteditable=true]")!.dispatchEvent(event);
		expect(editor.GetMarkdown().trim()).toBe("κατέβην χθὲς");
		expect(change).toHaveBeenCalled();
	});
});
