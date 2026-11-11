import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	keymap,
	ViewPlugin,
	type ViewUpdate,
	WidgetType
} from "@codemirror/view";
import {
	ConcealVisionReferences,
	FindVisionReferenceRanges
} from "../../shared/visions/VisionReferenceMarkdown.js";

class VisionReferenceWidget extends WidgetType
{
	public constructor(private readonly label: string, private readonly isWord: boolean)
	{
		super();
	}

	public override eq(other: VisionReferenceWidget): boolean
	{
		return other.label === this.label && other.isWord === this.isWord;
	}

	public override toDOM(): HTMLElement
	{
		const token = document.createElement("span");
		token.className = this.isWord ? "vision-markdown-word-reference" : "vision-markdown-range-reference";
		token.textContent = `[[${this.label}]]`;
		token.setAttribute("aria-label", `${this.isWord ? "Greek word" : "Greek text"} reference: ${this.label}`);
		token.title = this.isWord ? "Greek word reference" : "Greek text reference";
		return token;
	}

	public override ignoreEvent(): boolean
	{
		return true;
	}
}

function BuildReferenceDecorations(view: EditorView): DecorationSet
{
	const markdown = view.state.doc.toString();
	const decorations = FindVisionReferenceRanges(markdown).map((range) =>
		Decoration.replace({
			widget: new VisionReferenceWidget(range.placement.label, range.placement.presentation === "inline-word")
		}).range(range.from, range.to));
	return Decoration.set(decorations, true);
}

const referenceDecorations = ViewPlugin.fromClass(class
{
	public decorations: DecorationSet;

	public constructor(view: EditorView)
	{
		this.decorations = BuildReferenceDecorations(view);
	}

	public update(update: ViewUpdate): void
	{
		if (update.docChanged) this.decorations = BuildReferenceDecorations(update.view);
	}
}, {
	decorations: (value) => value.decorations
});

export class VisionMarkdownSourceEditor
{
	public readonly Root: HTMLElement = document.createElement("div");
	private readonly view: EditorView;

	public constructor(markdownValue: string, onChange: (value: string) => void)
	{
		this.Root.className = "vision-markdown-source";
		this.Root.setAttribute("aria-label", "Vision Markdown");
		this.view = new EditorView({
			parent: this.Root,
			state: EditorState.create({
				doc: markdownValue,
				extensions: [
					markdown(),
					history(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					EditorView.lineWrapping,
					referenceDecorations,
					EditorView.atomicRanges.of((view) =>
						view.plugin(referenceDecorations)?.decorations ?? Decoration.none),
					EditorView.clipboardOutputFilter.of((text) => ConcealVisionReferences(text)),
					EditorView.updateListener.of((update) =>
					{
						if (update.docChanged) onChange(update.state.doc.toString());
					})
				]
			})
		});
	}

	public GetMarkdown(): string
	{
		return this.view.state.doc.toString();
	}

	public Focus(): void
	{
		this.view.focus();
	}

	public Dispose(): void
	{
		this.view.destroy();
		this.Root.remove();
	}
}
