import { TabPanel } from "../ui/TabPanel.js";
import { DreamController } from "./DreamController.js";
import { MarkdownEditor } from "../ui/MarkdownEditor.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";

export class DreamReflectionsPanel extends TabPanel
{
	private readonly editor: MarkdownEditor;

	public constructor(private readonly controller: DreamController, reflection: string, errors: ErrorManager)
	{
		super("reflections", "Reflections");
		this.Root.classList.add("dream-reflections-tab");
		this.editor = new MarkdownEditor(reflection, "Reflections", this.HandleChange.bind(this), errors, false, "Record your reflections on this Dream.", "dreamReflectionsHeight");
		this.editor.Root.classList.add("dream-reflections-markdown");
		this.editor.Root.dataset.dreamReflections = "";
		this.Root.append(this.editor.Root);
	}

	public override Dispose(): void
	{
		this.editor.Dispose();
		super.Dispose();
	}

	public Update(reflection: string): void
	{
		this.editor.SetMarkdown(reflection);
	}

	private HandleChange(markdown: string): void
	{
		this.controller.UpdateReflection(markdown);
	}
}
