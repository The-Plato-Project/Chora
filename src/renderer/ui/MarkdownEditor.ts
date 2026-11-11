import { Editor, defaultValueCtx, rootCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx, parserCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, TextSelection, NodeSelection, EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Attrs, NodeType } from "@milkdown/kit/prose/model";
import { toggleMark, wrapIn, lift, chainCommands, setBlockType } from "@milkdown/kit/prose/commands";
import { wrapInList } from "@milkdown/kit/prose/schema-list";
import { undo, redo } from "@milkdown/kit/prose/history";
import { Bold, Italic, List, ListOrdered, ListChecks, Quote, Link, Unlink, Undo2, Redo2, Check, X, Strikethrough, Code2, Table2, Minus, createElement, type IconNode } from "lucide";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LayoutSettings, type LayoutDimension } from "../core/settings/LayoutSettingsStore.js";
import { MarkdownEditorGateway } from "./MarkdownEditorGateway.js";
import {
	AssertVisionReferencePlacement,
	DecodeVisionReferenceClipboardHtml,
	DecodeVisionReferenceDrag,
	VisionReferenceDragMime,
	type VisionReferenceDragPayload,
	type VisionReferencePlacement
} from "../../shared/visions/VisionReferenceTypes.js";
import { visionReferenceRemark, visionReferenceSchema } from "../visions/VisionReferencePlugin.js";
import type { VisionReferenceAction } from "../../shared/contracts/ChoraApi.js";

// A persistent Milkdown editor that stores Markdown through its owning feature's change handler.
export class MarkdownEditor
{
	// Stable wrapper containing the toolbar, link form, and resizable content.
	public readonly Root: HTMLElement = document.createElement("div");
	// Resolves after the editor becomes interactive, including failure reporting.
	public readonly Ready: Promise<void>;
	// Milkdown owns parsing, document state, keyboard behavior, and undo history.
	private readonly editor: Editor;
	// Mount point and scroll/resize boundary.
	private readonly content: HTMLElement = document.createElement("div");
	// Formatting controls remain mounted while their editor is hidden.
	private readonly toolbar: HTMLElement = document.createElement("div");
	private readonly headingSelect: HTMLSelectElement = document.createElement("select");
	// Inline link form preserves the document selection while accepting a URL.
	private readonly linkForm: HTMLFormElement = document.createElement("form");
	private readonly linkInput: HTMLInputElement = document.createElement("input");
	// Buttons indexed by command name for enabled and pressed states.
	private readonly buttons = new Map<string, HTMLButtonElement>();
	// Most recently published Markdown; initialization never writes a normalized value back.
	private markdown: string;
	// Marks teardown requested while asynchronous initialization may still be running.
	private disposed = false;
	// Indicates that Milkdown has finished initialization.
	private initialized = false;
	private replacing = false;
	// Retained DOM listeners.
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly pointerHandler = this.HandlePointerDown.bind(this);
	private readonly toolbarChangeHandler = this.HandleToolbarChange.bind(this);
	private readonly submitHandler = this.HandleLinkSubmit.bind(this);
	private readonly keyHandler = this.HandleLinkKeyDown.bind(this);
	private readonly contextHandler = this.HandleContextMenuAsync.bind(this);
	private readonly referencePointerHandler = this.HandleVisionReferencePointerDown.bind(this);
	private readonly dragOverHandler = this.HandleVisionReferenceDragOver.bind(this);
	private readonly dropHandler = this.HandleVisionReferenceDropAsync.bind(this);
	private readonly pasteHandler = this.HandleVisionReferencePasteAsync.bind(this);
	private readonly gateway = new MarkdownEditorGateway();
	private readonly pendingVisionInsertions = new Map<string, { readonly from: number; readonly to: number }>();
	// Persists an optional reader-adjusted editor height.
	private readonly resizeObserver: ResizeObserver | null;

	// Creates the editor without claiming ownership of its document or persistence.
	public constructor(markdown: string, private readonly label: string, private readonly onChange: (value: string) => void, private readonly errors: ErrorManager, private readonly readOnly = false, placeholder = "", private readonly layoutDimension: LayoutDimension | null = null, toolbarMode: "hidden" | "full" = "hidden", private readonly enableVisionReferences = false, private readonly onVisionReferenceAction?: (placement: VisionReferencePlacement, action: Exclude<VisionReferenceAction, "copy" | null>, relativeSelection?: { readonly start: number; readonly end: number }) => void | Promise<void>, private readonly onVisionSelectionDrop?: (payload: VisionReferenceDragPayload, requestId: string) => Promise<void>)
	{
		this.markdown = markdown;
		this.Root.className = "markdown-editor multiline-input";
		this.Root.setAttribute("aria-busy", "true");
		this.toolbar.className = "markdown-toolbar";
		this.toolbar.hidden = readOnly || toolbarMode === "hidden";
		this.toolbar.setAttribute("role", "group");
		this.toolbar.setAttribute("aria-label", `${label} formatting`);
		this.AddButton("bold", "Bold", Bold);
		this.AddButton("italic", "Italic", Italic);
		if (toolbarMode === "full")
		{
			this.AddButton("strike_through", "Strikethrough", Strikethrough);
			this.AddButton("inlineCode", "Inline code", Code2);
			this.AddHeadingSelect();
		}
		this.AddButton("bullet_list", "Bulleted list", List);
		this.AddButton("ordered_list", "Numbered list", ListOrdered);
		if (toolbarMode === "full") this.AddButton("task_list", "Task list", ListChecks);
		this.AddButton("blockquote", "Quotation", Quote);
		if (toolbarMode === "full")
		{
			this.AddButton("code_block", "Code block", Code2);
			this.AddButton("table", "Table", Table2);
			this.AddButton("hr", "Horizontal rule", Minus);
		}
		this.AddButton("link", "Edit link", Link);
		this.AddButton("unlink", "Remove link", Unlink);
		this.AddButton("undo", "Undo", Undo2);
		this.AddButton("redo", "Redo", Redo2);
		this.content.className = "markdown-content";
		if (this.layoutDimension !== null)
		{
			const height = LayoutSettings.GetDimension(this.layoutDimension, 0);
			if (height > 0) this.content.style.height = `${height}px`;
		}
		if (placeholder.length > 0) this.content.dataset.placeholder = placeholder;
		this.linkForm.className = "markdown-link-form";
		this.linkForm.hidden = true;
		this.linkInput.type = "url";
		this.linkInput.required = true;
		this.linkInput.setAttribute("aria-label", "Link URL");
		this.linkInput.placeholder = "https://";
		const apply = this.CreateButton("apply-link", "Apply link", Check);
		apply.type = "submit";
		const cancel = this.CreateButton("cancel-link", "Cancel link", X);
		this.linkForm.append(this.linkInput, apply, cancel);
		this.Root.append(this.toolbar, this.linkForm, this.content);
		this.resizeObserver = this.layoutDimension === null ? null : new ResizeObserver(this.HandleResize.bind(this));
		this.resizeObserver?.observe(this.content);
		this.Root.addEventListener("click", this.clickHandler);
		if (!readOnly || enableVisionReferences) this.content.addEventListener("contextmenu", this.contextHandler);
		if (enableVisionReferences) this.content.addEventListener("mousedown", this.referencePointerHandler);
		if (enableVisionReferences && !readOnly)
		{
			this.content.addEventListener("dragover", this.dragOverHandler);
			this.content.addEventListener("drop", this.dropHandler);
			this.content.addEventListener("paste", this.pasteHandler);
		}
		this.toolbar.addEventListener("pointerdown", this.pointerHandler);
		this.toolbar.addEventListener("change", this.toolbarChangeHandler);
		this.linkForm.addEventListener("submit", this.submitHandler);
		this.linkForm.addEventListener("keydown", this.keyHandler);
		const changes = $prose(this.CreateChangePlugin.bind(this));
		this.editor = Editor.make();
		this.editor.config(this.Configure.bind(this));
		this.editor.use(commonmark);
		if (toolbarMode === "full") this.editor.use(gfm);
		if (enableVisionReferences)
		{
			this.editor.use(visionReferenceRemark);
			this.editor.use(visionReferenceSchema);
		}
		this.editor.use(history);
		this.editor.use(changes);
		this.Ready = this.InitializeAsync();
	}

	// Returns the current Markdown without re-parsing or replacing the document.
	public GetMarkdown(): string
	{
		return this.markdown;
	}

	public SetMarkdown(markdown: string): void
	{
		if (markdown !== this.markdown && !this.disposed)
		{
			this.markdown = markdown;
			if (this.initialized) this.ReplaceDocument();
		}
	}

	private ReplaceDocument(): void
	{
		const view = this.editor.ctx.get(editorViewCtx);
		const parse = this.editor.ctx.get(parserCtx);
		const doc = parse(this.markdown);
		this.replacing = true;
		try
		{
			view.updateState(EditorState.create({ doc, schema: view.state.schema, plugins: view.state.plugins }));
			view.dom.setAttribute("role", this.readOnly ? "document" : "textbox");
			this.UpdateToolbar(view);
		}
		finally
		{
			this.replacing = false;
		}
	}

	// Gives typing focus to the document once its editor is ready.
	public Focus(): void
	{
		if (this.initialized && !this.disposed)
		{
			const view = this.editor.ctx.get(editorViewCtx);
			view.focus();
		}
	}

	public InsertVisionReference(placement: VisionReferencePlacement, requestId?: string): void
	{
		AssertVisionReferencePlacement(placement);
		if (!this.enableVisionReferences || this.readOnly || !this.initialized || this.disposed)
		{
			throw new Error("The Vision editor is not ready to insert a reference.");
		}
		const view = this.editor.ctx.get(editorViewCtx);
		const type = view.state.schema.nodes.vision_reference;
		if (type === undefined) throw new Error("The Vision reference schema is unavailable.");
		const reference = type.create({
			id: placement.id,
			visionId: placement.visionId,
			anchorId: placement.anchorId,
			presentation: placement.presentation,
			label: placement.label
		});
		const insertion = requestId === undefined ? undefined : this.pendingVisionInsertions.get(requestId);
		if (requestId !== undefined) this.pendingVisionInsertions.delete(requestId);
		const transaction = insertion === undefined
			? view.state.tr.replaceSelectionWith(reference)
			: view.state.tr.replaceRangeWith(
				Math.max(0, Math.min(insertion.from, view.state.doc.content.size)),
				Math.max(0, Math.min(insertion.to, view.state.doc.content.size)),
				reference);
		view.dispatch(transaction.scrollIntoView());
		view.focus();
	}

	public FocusVisionReference(placementId: string): void
	{
		if (!this.enableVisionReferences || !this.initialized || this.disposed)
		{
			throw new Error("The Vision editor is not ready to reveal a reference.");
		}
		const reference = Array.from(this.content.querySelectorAll<HTMLElement>("[data-placement-id]"))
			.find((candidate) => candidate.dataset.placementId === placementId);
		if (reference === undefined) throw new Error("The Vision reference placement is missing.");
		const view = this.editor.ctx.get(editorViewCtx);
		const position = view.posAtDOM(reference, 0);
		view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)).scrollIntoView());
		reference.scrollIntoView?.({ block: "center", behavior: "smooth" });
		view.focus();
	}

	// Validates destinations without allowing file, data, or executable URL schemes.
	public static IsSafeLink(value: string): boolean
	{
		let safe = false;
		try
		{
			const url = new URL(value);
			safe = ["https:", "http:", "mailto:"].includes(url.protocol);
		}
		catch
		{
			safe = false;
		}
		return safe;
	}

	// Stops callbacks immediately and destroys Milkdown after pending initialization finishes.
	public Dispose(): void
	{
		this.disposed = true;
		this.Root.removeEventListener("click", this.clickHandler);
		this.content.removeEventListener("contextmenu", this.contextHandler);
		this.content.removeEventListener("mousedown", this.referencePointerHandler);
		this.content.removeEventListener("dragover", this.dragOverHandler);
		this.content.removeEventListener("drop", this.dropHandler);
		this.content.removeEventListener("paste", this.pasteHandler);
		this.toolbar.removeEventListener("pointerdown", this.pointerHandler);
		this.toolbar.removeEventListener("change", this.toolbarChangeHandler);
		this.linkForm.removeEventListener("submit", this.submitHandler);
		this.linkForm.removeEventListener("keydown", this.keyHandler);
		this.resizeObserver?.disconnect();
		this.Root.remove();
		if (this.initialized) void this.DestroyAsync();
	}

	private HandleVisionReferenceDragOver(event: DragEvent): void
	{
		if (event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes(VisionReferenceDragMime))
		{
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		}
	}

	private HandleVisionReferencePointerDown(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const reference = target?.closest("[data-vision-reference]");
		if (reference !== null && reference !== undefined)
		{
			event.stopImmediatePropagation();
		}
	}

	private async HandleVisionReferenceDropAsync(event: DragEvent): Promise<void>
	{
		const dataTransfer = event.dataTransfer;
		const serialized = dataTransfer?.getData(VisionReferenceDragMime) ?? "";
		if (serialized.length === 0 || this.onVisionSelectionDrop === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		try
		{
			const payload = DecodeVisionReferenceDrag(serialized);
			const view = this.editor.ctx.get(editorViewCtx);
			const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
			const requestId = crypto.randomUUID();
			const position = hit?.pos ?? view.state.selection.from;
			this.pendingVisionInsertions.set(requestId, { from: position, to: position });
			try
			{
				await this.onVisionSelectionDrop(payload, requestId);
			}
			finally
			{
				this.pendingVisionInsertions.delete(requestId);
			}
		}
		catch (error)
		{
			if (!this.disposed) this.errors.Report("MarkdownEditor", error, "The selected text could not be placed in the Vision.");
		}
	}

	private async HandleVisionReferencePasteAsync(event: ClipboardEvent): Promise<void>
	{
		const clipboard = event.clipboardData;
		if (clipboard === null || this.onVisionSelectionDrop === undefined) return;
		const serialized = clipboard.getData(VisionReferenceDragMime);
		const html = clipboard.getData("text/html");
		if (serialized.length === 0 && html.length === 0) return;
		try
		{
			const payload = serialized.length > 0
				? DecodeVisionReferenceDrag(serialized)
				: DecodeVisionReferenceClipboardHtml(html);
			if (payload === null) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const view = this.editor.ctx.get(editorViewCtx);
			const requestId = crypto.randomUUID();
			this.pendingVisionInsertions.set(requestId, {
				from: view.state.selection.from,
				to: view.state.selection.to
			});
			try
			{
				await this.onVisionSelectionDrop(payload, requestId);
			}
			finally
			{
				this.pendingVisionInsertions.delete(requestId);
			}
		}
		catch (error)
		{
			event.preventDefault();
			if (!this.disposed) this.errors.Report("MarkdownEditor", error, "The copied anchor could not be placed in the Vision.");
		}
	}

	// Mounts Markdown and accessible content; image nodes never initiate network requests.
	private Configure(ctx: Ctx): void
	{
		ctx.set(rootCtx, this.content);
		ctx.set(defaultValueCtx, this.markdown);
		ctx.set(editorViewOptionsCtx, {
			editable: this.IsEditable.bind(this),
			attributes: { role: this.readOnly ? "document" : "textbox", "aria-label": this.label, "aria-multiline": "true", spellcheck: String(!this.readOnly) },
			nodeViews: { image: this.RenderImageText.bind(this) }
		});
	}

	private IsEditable(): boolean
	{
		return !this.readOnly;
	}

	// Persists visible writing-surface height changes caused by the native resize handle.
	private HandleResize(): void
	{
		if (this.layoutDimension !== null)
		{
			const height = this.content.getBoundingClientRect().height;
			if (height >= 40) LayoutSettings.SetDimension(this.layoutDimension, height);
		}
	}

	// Displays image alt text without loading media from Markdown.
	private RenderImageText(node: import("@milkdown/kit/prose/model").Node): { dom: HTMLElement }
	{
		const dom = document.createElement("span");
		dom.textContent = node.attrs.alt || "[Image]";
		return { dom };
	}

	// Publishes changes directly from transactions, including undo and paste, before autosave can run.
	private CreateChangePlugin(ctx: Ctx): Plugin
	{
		const owner = this;
		return new Plugin({
			view: function CreateView()
			{
				return {
					update: function Update(view: EditorView, previous: EditorState): void
					{
						if (!owner.disposed)
						{
							if (!owner.readOnly && !owner.replacing && !previous.doc.eq(view.state.doc))
							{
								const serialize = ctx.get(serializerCtx);
								const markdown = serialize(view.state.doc);
								if (markdown !== owner.markdown)
								{
									owner.markdown = markdown;
									owner.onChange(markdown);
								}
							}
							owner.UpdateToolbar(view);
						}
					}
				};
			}
		});
	}

	// Enables editing after setup or shows a noneditable fallback if initialization fails.
	private async InitializeAsync(): Promise<void>
	{
		try
		{
			await this.editor.create();
			this.initialized = true;
			this.ReplaceDocument();
			if (this.disposed) await this.DestroyAsync();
			else
			{
				this.Root.setAttribute("aria-busy", "false");
				const view = this.editor.ctx.get(editorViewCtx);
				this.UpdateToolbar(view);
			}
		}
		catch (error)
		{
			if (!this.disposed)
			{
				this.content.textContent = this.markdown;
				this.Root.setAttribute("aria-busy", "false");
				this.errors.Report("MarkdownEditor", error, "Unable to open the formatting editor. Your text has not been changed.");
			}
		}
	}

	// Tears down editor plugins and their observers safely.
	private async DestroyAsync(): Promise<void>
	{
		this.initialized = false;
		try
		{
			await this.editor.destroy();
		}
		catch (error)
		{
			this.errors.Report("MarkdownEditor", error, "Unable to release the formatting editor.");
		}
	}

	// Creates one tooltip-labelled icon button using the shared icon library.
	private CreateButton(command: string, label: string, icon: IconNode): HTMLButtonElement
	{
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.markdownCommand = command;
		button.title = label;
		button.setAttribute("aria-label", label);
		const graphic = createElement(icon);
		graphic.setAttribute("aria-hidden", "true");
		button.append(graphic);
		return button;
	}

	// Adds a disabled formatting button until Milkdown is ready.
	private AddButton(command: string, label: string, icon: IconNode): void
	{
		const button = this.CreateButton(command, label, icon);
		button.disabled = true;
		this.buttons.set(command, button);
		this.toolbar.append(button);
	}

	private AddHeadingSelect(): void
	{
		this.headingSelect.className = "markdown-heading-select";
		this.headingSelect.dataset.markdownHeading = "";
		this.headingSelect.title = "Text style";
		this.headingSelect.setAttribute("aria-label", "Text style");
		this.headingSelect.disabled = true;
		const options: ReadonlyArray<readonly [string, string]> = [
			["paragraph", "Normal"],
			["1", "Heading 1"],
			["2", "Heading 2"],
			["3", "Heading 3"],
			["4", "Heading 4"]
		];
		for (const [value, label] of options)
		{
			const option = document.createElement("option");
			option.value = value;
			option.textContent = label;
			this.headingSelect.append(option);
		}
		this.toolbar.append(this.headingSelect);
	}

	// Preserves document selection when a pointer activates the formatting toolbar.
	private HandlePointerDown(event: PointerEvent): void
	{
		const target = event.target as Element | null;
		if (target?.closest("[data-markdown-heading]") === null) event.preventDefault();
	}

	private HandleToolbarChange(event: Event): void
	{
		if (event.target !== this.headingSelect || !this.initialized || this.disposed) return;
		const view = this.editor.ctx.get(editorViewCtx);
		const command = this.headingSelect.value === "paragraph"
			? "paragraph"
			: `heading_${this.headingSelect.value}`;
		this.RunCommand(command, view);
		view.focus();
	}

	// Prevents navigation from content links and routes formatting actions.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target as Element | null;
		const rangeWord = target?.closest<HTMLElement>("[data-vision-range-word]");
		const rangeReference = rangeWord?.closest<HTMLElement>('[data-vision-reference="inline-range"]');
		const wordReference = target?.closest<HTMLElement>('[data-vision-reference="inline-word"]');
		if (rangeWord !== null && rangeWord !== undefined && rangeReference !== null && rangeReference !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			const relativeSelection = this.GetRangeWordSelection(rangeWord, rangeReference);
			if (relativeSelection !== undefined)
				void this.OpenVisionReferenceWordAsync(rangeReference, relativeSelection);
			return;
		}
		if (wordReference !== null && wordReference !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			void this.OpenVisionReferenceWordAsync(wordReference);
			return;
		}
		if (target?.closest("a") != null) event.preventDefault();
		if (target === this.content && !this.readOnly && this.initialized && !this.disposed)
		{
			const view = this.editor.ctx.get(editorViewCtx);
			const browserSelection = window.getSelection();
			const anchor = browserSelection?.anchorNode ?? null;
			const focus = browserSelection?.focusNode ?? null;
			const selectionBelongsToEditor = (anchor !== null && this.content.contains(anchor))
				|| (focus !== null && this.content.contains(focus));
			const hasSelectedText = browserSelection !== null && !browserSelection.isCollapsed && selectionBelongsToEditor;
			if (view.state.selection.empty && !hasSelectedText)
			{
				const selection = TextSelection.atEnd(view.state.doc);
				view.dispatch(view.state.tr.setSelection(selection));
				view.focus();
			}
		}
		const command = target?.closest<HTMLElement>("[data-markdown-command]")?.dataset.markdownCommand;
		if (command !== undefined && this.initialized && !this.disposed)
		{
			const view = this.editor.ctx.get(editorViewCtx);
			if (command === "link") this.OpenLinkForm(view);
			else if (command === "cancel-link") this.CloseLinkForm(view);
			else if (command !== "apply-link")
			{
				this.RunCommand(command, view);
				view.focus();
			}
		}
	}

	private async HandleContextMenuAsync(event: MouseEvent): Promise<void>
	{
		if (this.initialized && !this.disposed)
		{
			const target = event.target as HTMLElement | null;
			const reference = target?.closest<HTMLElement>("[data-vision-reference]");
			if (reference !== null && reference !== undefined)
			{
				event.preventDefault();
				event.stopPropagation();
				await this.HandleVisionReferenceContextMenuAsync(reference, target);
				return;
			}
			if (this.readOnly) return;
			event.stopPropagation();
			const view = this.editor.ctx.get(editorViewCtx);
			const original = view.state.doc;
			try
			{
				const command = await this.gateway.ShowFormattingMenuAsync();
				if (command !== null && !this.disposed && original.eq(view.state.doc))
				{
					this.SelectContextWord(view, event);
					if (command === "link") this.OpenLinkForm(view);
					else
					{
						this.RunCommand(command, view);
						view.focus();
					}
				}
			}
			catch (error)
			{
				if (!this.disposed) this.errors.Report("MarkdownEditor", error, "Unable to open the formatting menu.");
			}
		}
	}

	private async HandleVisionReferenceContextMenuAsync(reference: HTMLElement, target: HTMLElement | null): Promise<void>
	{
		const presentation = reference.dataset.visionReference === "inline-range"
			? "inline-range"
			: "inline-word";
		const placement = this.ReadVisionReferencePlacement(reference, presentation);
		try
		{
			AssertVisionReferencePlacement(placement);
			const rangeWord = target?.closest<HTMLElement>("[data-vision-range-word]");
			const relativeSelection = rangeWord === null || rangeWord === undefined
				? undefined
				: this.GetRangeWordSelection(rangeWord, reference);
			const selectedText = relativeSelection === undefined
				? placement.label
				: placement.label.slice(relativeSelection.start, relativeSelection.end);
			const action = await this.gateway.ShowVisionReferenceMenuAsync(
				placement.presentation === "inline-word" || relativeSelection !== undefined);
			if (action === "copy") await this.gateway.CopyTextAsync(selectedText);
			else if (action === "navigate" || action === "explore-word")
			{
				if (action === "explore-word" && relativeSelection !== undefined)
					await this.onVisionReferenceAction?.(placement, action, relativeSelection);
				else await this.onVisionReferenceAction?.(placement, action);
			}
		}
		catch (error)
		{
			if (!this.disposed) this.errors.Report("MarkdownEditor", error, "Unable to use this Vision text reference.");
		}
	}

	private async OpenVisionReferenceWordAsync(reference: HTMLElement, relativeSelection?: { readonly start: number; readonly end: number }): Promise<void>
	{
		try
		{
			const presentation = reference.dataset.visionReference === "inline-range"
				? "inline-range"
				: "inline-word";
			const placement = this.ReadVisionReferencePlacement(reference, presentation);
			AssertVisionReferencePlacement(placement);
			if (relativeSelection === undefined)
				await this.onVisionReferenceAction?.(placement, "explore-word");
			else await this.onVisionReferenceAction?.(placement, "explore-word", relativeSelection);
		}
		catch (error)
		{
			if (!this.disposed) this.errors.Report("MarkdownEditor", error, "Unable to open this Vision word reference.");
		}
	}

	private ReadVisionReferencePlacement(reference: HTMLElement, presentation: VisionReferencePlacement["presentation"]): VisionReferencePlacement
	{
		return {
			id: reference.dataset.placementId ?? "",
			visionId: reference.dataset.visionId ?? "",
			anchorId: reference.dataset.anchorId ?? "",
			presentation,
			label: reference.textContent ?? ""
		};
	}

	private GetRangeWordSelection(word: HTMLElement, reference: HTMLElement): { readonly start: number; readonly end: number } | undefined
	{
		if (!reference.contains(word)) return undefined;
		const start = Number.parseInt(word.dataset.wordStart ?? "", 10);
		const end = Number.parseInt(word.dataset.wordEnd ?? "", 10);
		return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end
			? { start, end }
			: undefined;
	}

	private SelectContextWord(view: EditorView, event: MouseEvent): void
	{
		const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
		const selection = view.state.selection;
		if (hit !== null && (selection.empty || hit.pos < selection.from || hit.pos > selection.to))
		{
			const position = view.state.doc.resolve(hit.pos);
			if (position.parent.isTextblock)
			{
				const text = position.parent.textBetween(0, position.parent.content.size, "", "\ufffc");
				const words = text.matchAll(/[\p{L}\p{M}\p{N}_'\u2019]+/gu);
				for (const word of words)
				{
					const start = word.index;
					const end = start + word[0].length;
					if (start <= position.parentOffset && position.parentOffset <= end)
					{
						const selectedWord = TextSelection.create(view.state.doc, position.start() + start, position.start() + end);
						const transaction = view.state.tr.setSelection(selectedWord);
						view.dispatch(transaction);
						break;
					}
				}
			}
		}
	}

	// Applies a formatting transaction using ProseMirror's established commands.
	private RunCommand(command: string, view: EditorView): void
	{
		const state = view.state;
		const dispatch = view.dispatch.bind(view);
		const marks = state.schema.marks;
		if (command === "bold" && marks.strong !== undefined) toggleMark(marks.strong)(state, dispatch);
		else if (command === "italic" && marks.emphasis !== undefined) toggleMark(marks.emphasis)(state, dispatch);
		else if (command === "strike_through" && marks.strike_through !== undefined) toggleMark(marks.strike_through)(state, dispatch);
		else if (command === "inlineCode" && marks.inlineCode !== undefined) toggleMark(marks.inlineCode)(state, dispatch);
		else if (command.startsWith("heading_") && state.schema.nodes.heading !== undefined)
		{
			const level = Number(command.slice("heading_".length));
			this.ApplyTextStyle(view, state.schema.nodes.heading, { level });
		}
		else if (command === "paragraph" && state.schema.nodes.paragraph !== undefined)
		{
			this.ApplyTextStyle(view, state.schema.nodes.paragraph);
		}
		else if (command === "code_block" && state.schema.nodes.code_block !== undefined)
		{
			setBlockType(state.schema.nodes.code_block)(state, dispatch);
		}
		else if (command === "hr" && state.schema.nodes.hr !== undefined)
		{
			view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hr.create()).scrollIntoView());
		}
		else if (command === "table") this.InsertTable(view);
		else if (command === "task_list") this.InsertTaskList(view);
		else if (command === "undo") undo(state, dispatch);
		else if (command === "redo") redo(state, dispatch);
		else if (command === "unlink" && marks.link !== undefined)
		{
			const transaction = state.tr.removeMark(state.selection.from, state.selection.to, marks.link);
			view.dispatch(transaction);
		}
		else
		{
			const type = state.schema.nodes[command];
			if (type !== undefined)
			{
				const wrap = command === "blockquote" ? wrapIn(type) : wrapInList(type);
				const apply = this.IsNodeActive(state, command) ? chainCommands(lift, wrap) : wrap;
				apply(state, dispatch);
			}
		}
	}

	// Turns selected hard-break lines into independent blocks before applying their text style.
	private ApplyTextStyle(view: EditorView, type: NodeType, attributes?: Attrs): void
	{
		const state = view.state;
		const selection = state.selection;
		const boundaries: { from: number; to: number; split: boolean }[] = [];
		const multilineHeadings: number[] = [];
		state.doc.nodesBetween(selection.from, selection.to, function CollectBoundaries(node, position): boolean
		{
			if (node.type.name === "paragraph" || node.type.name === "heading")
			{
				const breaks: { from: number; to: number }[] = [];
				node.forEach(function CollectBreak(child, offset): void
				{
					if (child.type.name === "hardbreak")
					{
						const previous = breaks.at(-1);
						if (previous !== undefined && previous.to === offset)
						{
							previous.to += child.nodeSize;
						}
						else
						{
							breaks.push({ from: offset, to: offset + child.nodeSize });
						}
					}
				});
				if (node.type.name === "heading" && breaks.length > 0)
				{
					multilineHeadings.push(position);
				}
				const contentStart = position + 1;
				const from = Math.max(0, selection.from - contentStart);
				const to = Math.min(node.content.size, selection.to - contentStart);
				let lineStart = 0;
				let lineEnd = node.content.size;
				for (const boundary of breaks)
				{
					if (boundary.to <= from)
					{
						lineStart = boundary.to;
					}
					if (boundary.from >= to && lineEnd === node.content.size)
					{
						lineEnd = boundary.from;
					}
				}
				for (const boundary of breaks)
				{
					if (boundary.to >= lineStart && boundary.from <= lineEnd)
					{
						boundaries.push({
							from: contentStart + boundary.from,
							to: contentStart + boundary.to,
							split: boundary.from > 0 && boundary.to < node.content.size
						});
					}
				}
			}
			const visitChildren = !node.isTextblock;
			return visitChildren;
		});
		const transaction = state.tr;
		// Existing multiline headings must not pass their style to the separated surrounding prose.
		const paragraph = state.schema.nodes.paragraph;
		if (paragraph !== undefined)
		{
			for (const position of multilineHeadings)
			{
				transaction.setNodeMarkup(position, paragraph);
			}
		}
		// Work backwards so every recorded position still belongs to the original document.
		for (let index = boundaries.length - 1; index >= 0; index -= 1)
		{
			const boundary = boundaries[index]!;
			if (boundary.split)
			{
				transaction.split(boundary.to);
			}
			transaction.delete(boundary.from, boundary.to);
		}
		const mappedSelection = transaction.selection;
		transaction.setBlockType(mappedSelection.from, mappedSelection.to, type, attributes);
		transaction.scrollIntoView();
		view.dispatch(transaction);
	}

	private InsertTable(view: EditorView): void
	{
		const nodes = view.state.schema.nodes;
		if (nodes.table !== undefined && nodes.table_header_row !== undefined && nodes.table_header !== undefined
			&& nodes.table_row !== undefined && nodes.table_cell !== undefined)
		{
			const header = nodes.table_header.createAndFill();
			const cell = nodes.table_cell.createAndFill();
			if (header !== null && cell !== null)
			{
				const heading = nodes.table_header_row.create(null, [header, header]);
				const row = nodes.table_row.create(null, [cell, cell]);
				const table = nodes.table.create(null, [heading, row]);
				view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView());
			}
		}
	}

	private InsertTaskList(view: EditorView): void
	{
		const list = view.state.schema.nodes.bullet_list;
		if (list !== undefined && wrapInList(list)(view.state, view.dispatch))
		{
			const state = view.state;
			for (let depth = state.selection.$from.depth; depth > 0; depth -= 1)
			{
				const node = state.selection.$from.node(depth);
				if (node.type.name === "list_item")
				{
					const position = state.selection.$from.before(depth);
					view.dispatch(state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: false }));
					break;
				}
			}
		}
	}

	// Reports whether the caret is inside a list or quotation.
	private IsNodeActive(state: EditorState, name: string): boolean
	{
		let active = false;
		for (let depth = state.selection.$from.depth; depth > 0; depth -= 1)
		{
			if (state.selection.$from.node(depth).type.name === name) active = true;
		}
		return active;
	}

	// Reflects current marks, containing blocks, and undo availability.
	private UpdateToolbar(view: EditorView): void
	{
		const state = view.state;
		const marks = state.storedMarks ?? state.selection.$from.marks();
		this.headingSelect.disabled = !this.initialized;
		this.headingSelect.value = state.selection.$from.parent.type.name === "heading"
			? String(state.selection.$from.parent.attrs.level)
			: "paragraph";
		for (const [command, button] of this.buttons)
		{
			button.disabled = !this.initialized;
			let active = false;
			const markName = command === "bold" ? "strong" : command === "italic" ? "emphasis" : command;
			for (const mark of marks)
			{
				if (mark.type.name === markName) active = true;
			}
			if (["bullet_list", "ordered_list", "blockquote", "code_block"].includes(command)) active = this.IsNodeActive(state, command);
			if (command.startsWith("heading_")) active = this.IsHeadingActive(state, Number(command.slice("heading_".length)));
			if (command === "undo") button.disabled = !undo(state);
			else if (command === "redo") button.disabled = !redo(state);
			else if (["bold", "italic", "strike_through", "inlineCode", "bullet_list", "ordered_list", "blockquote", "code_block"].includes(command) || command.startsWith("heading_")) button.setAttribute("aria-pressed", String(active));
			if (command === "link" || command === "unlink") button.disabled = state.selection.empty;
		}
	}

	private IsHeadingActive(state: EditorState, level: number): boolean
	{
		const parent = state.selection.$from.parent;
		return parent.type.name === "heading" && parent.attrs.level === level;
	}

	// Presents a URL field without modifying the current document selection.
	private OpenLinkForm(view: EditorView): void
	{
		this.linkInput.value = "";
		const marks = view.state.selection.$from.marks();
		for (const mark of marks)
		{
			if (mark.type.name === "link") this.linkInput.value = mark.attrs.href;
		}
		this.linkInput.setCustomValidity("");
		this.linkForm.hidden = false;
		this.linkInput.focus();
	}

	// Applies only permitted URL protocols to the preserved selection.
	private HandleLinkSubmit(event: SubmitEvent): void
	{
		event.preventDefault();
		const href = this.linkInput.value.trim();
		const safe = MarkdownEditor.IsSafeLink(href);
		this.linkInput.setCustomValidity(safe ? "" : "Use an https, http, or mailto URL.");
		if (safe && this.initialized)
		{
			const view = this.editor.ctx.get(editorViewCtx);
			const mark = view.state.schema.marks.link;
			if (mark !== undefined)
			{
				const link = mark.create({ href });
				const transaction = view.state.tr.addMark(view.state.selection.from, view.state.selection.to, link);
				view.dispatch(transaction);
			}
			this.CloseLinkForm(view);
		}
		else this.linkInput.reportValidity();
	}

	// Cancels link editing without changing content.
	private HandleLinkKeyDown(event: KeyboardEvent): void
	{
		this.linkInput.setCustomValidity("");
		if (event.key === "Escape" && this.initialized)
		{
			event.preventDefault();
			const view = this.editor.ctx.get(editorViewCtx);
			this.CloseLinkForm(view);
		}
	}

	// Restores focus to the document after editing or cancelling a link.
	private CloseLinkForm(view: EditorView): void
	{
		this.linkForm.hidden = true;
		view.focus();
	}
}
