import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { MarkdownEditor } from "../ui/MarkdownEditor.js";
import { TabPanel } from "../ui/TabPanel.js";
import { IdeaController } from "./IdeaController.js";

// Owns the full-height reader-authored Seeing editor for one Idea.
export class IdeaSeeingPanel extends TabPanel
{
	// Contains the persistent Markdown writing surface.
	private readonly editor: MarkdownEditor;

	// Creates the Seeing tab over the Idea's authoritative content field.
	public constructor(private readonly controller: IdeaController, content: string, errors: ErrorManager)
	{
		super("seeing", "Seeing");
		this.Root.classList.add("idea-seeing-tab");
		this.editor = new MarkdownEditor(
			content,
			"Seeing",
			this.HandleChange.bind(this),
			errors,
			false,
			"Write what this Idea allows you to see.",
			"ideaSeeingHeight");
		this.editor.Root.classList.add("idea-seeing-markdown");
		this.editor.Root.dataset.ideaSeeing = "";
		this.Root.append(this.editor.Root);
	}

	// Releases the Markdown editor owned by this tab.
	public override Dispose(): void
	{
		this.editor.Dispose();
		super.Dispose();
	}

	// Persists Seeing edits through the Idea workflow.
	private HandleChange(markdown: string): void
	{
		this.controller.UpdateSeeing(markdown);
	}
}
