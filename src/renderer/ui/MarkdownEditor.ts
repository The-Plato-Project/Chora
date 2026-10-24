import { Editor, defaultValueCtx, rootCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx, parserCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { history } from "@milkdown/kit/plugin/history";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, TextSelection, EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { toggleMark, wrapIn, lift, chainCommands } from "@milkdown/kit/prose/commands";
import { wrapInList } from "@milkdown/kit/prose/schema-list";
import { undo, redo } from "@milkdown/kit/prose/history";
import { Bold, Italic, List, ListOrdered, Quote, Link, Unlink, Undo2, Redo2, Check, X, createElement, type IconNode } from "lucide";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LayoutSettings, type LayoutDimension } from "../core/settings/LayoutSettingsStore.js";
import { MarkdownEditorGateway } from "./MarkdownEditorGateway.js";

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
	private readonly submitHandler = this.HandleLinkSubmit.bind(this);
	private readonly keyHandler = this.HandleLinkKeyDown.bind(this);
	private readonly contextHandler = this.HandleContextMenuAsync.bind(this);
	private readonly gateway = new MarkdownEditorGateway();
	// Persists an optional reader-adjusted editor height.
	private readonly resizeObserver: ResizeObserver | null;

	// Creates the editor without claiming ownership of the Dream or its persistence.
	public constructor(markdown: string, private readonly label: string, private readonly onChange: (value: string) => void, private readonly errors: ErrorManager, private readonly readOnly = false, placeholder = "", private readonly layoutDimension: LayoutDimension | null = null)
	{
		this.markdown = markdown;
		this.Root.className = "markdown-editor";
		this.Root.setAttribute("aria-busy", "true");
		this.toolbar.className = "markdown-toolbar";
		this.toolbar.hidden = true;
		this.toolbar.setAttribute("role", "group");
		this.toolbar.setAttribute("aria-label", `${label} formatting`);
		this.AddButton("bold", "Bold", Bold);
		this.AddButton("italic", "Italic", Italic);
		this.AddButton("bullet_list", "Bulleted list", List);
		this.AddButton("ordered_list", "Numbered list", ListOrdered);
		this.AddButton("blockquote", "Quotation", Quote);
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
		if (!readOnly) this.content.addEventListener("contextmenu", this.contextHandler);
		this.toolbar.addEventListener("pointerdown", this.pointerHandler);
		this.linkForm.addEventListener("submit", this.submitHandler);
		this.linkForm.addEventListener("keydown", this.keyHandler);
		const changes = $prose(this.CreateChangePlugin.bind(this));
		this.editor = Editor.make();
		this.editor.config(this.Configure.bind(this));
		this.editor.use(commonmark);
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
		this.toolbar.removeEventListener("pointerdown", this.pointerHandler);
		this.linkForm.removeEventListener("submit", this.submitHandler);
		this.linkForm.removeEventListener("keydown", this.keyHandler);
		this.resizeObserver?.disconnect();
		this.Root.remove();
		if (this.initialized) void this.DestroyAsync();
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

	// Displays image alt text without loading media from a Dream's Markdown.
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

	// Preserves document selection when a pointer activates the formatting toolbar.
	private HandlePointerDown(event: PointerEvent): void
	{
		event.preventDefault();
	}

	// Prevents navigation from content links and routes formatting actions.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target as Element | null;
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
		for (const [command, button] of this.buttons)
		{
			button.disabled = !this.initialized;
			let active = false;
			const markName = command === "bold" ? "strong" : command === "italic" ? "emphasis" : command;
			for (const mark of marks)
			{
				if (mark.type.name === markName) active = true;
			}
			if (["bullet_list", "ordered_list", "blockquote"].includes(command)) active = this.IsNodeActive(state, command);
			if (command === "undo") button.disabled = !undo(state);
			else if (command === "redo") button.disabled = !redo(state);
			else if (["bold", "italic", "bullet_list", "ordered_list", "blockquote"].includes(command)) button.setAttribute("aria-pressed", String(active));
			if (command === "link" || command === "unlink") button.disabled = state.selection.empty;
		}
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