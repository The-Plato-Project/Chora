import type { DreamClarityCheckController } from "./DreamClarityCheckController.js";
import type { DreamExportController } from "./DreamExportController.js";
import type { DreamView } from "./DreamView.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { CloseIcon, CopyIcon, IlluminateIcon } from "../ui/Icons.js";
import { MarkdownEditor } from "../ui/MarkdownEditor.js";
import { RenderProgressBar } from "../ui/ProgressBar.js";
import { TabPanel } from "../ui/TabPanel.js";
import { DreamController } from "./DreamController.js";

export class DreamSynopticViewPanel extends TabPanel
{
	private readonly editor: MarkdownEditor;
	private readonly createButton: HTMLButtonElement;
	private readonly copyButton: HTMLButtonElement;
	private readonly progress: HTMLElement;
	private readonly clickHandler = this.HandleClick.bind(this);

	public constructor(private readonly controller: DreamController, private readonly clarity: DreamClarityCheckController, private readonly exports: DreamExportController, dream: DreamView, private readonly errors: ErrorManager)
	{
		super("synoptic-view", "Clarity Check");
		this.Root.classList.add("dream-synoptic-view-tab");
		const actions = document.createElement("div");
		actions.className = "dream-synoptic-view-actions";
		actions.innerHTML = `<button class="dream-icon-button button-control" data-create-synoptic-view type="button" title="Check clarity" aria-label="Check clarity">${IlluminateIcon}</button><button class="dream-icon-button button-control" data-copy-synoptic-view type="button" title="Copy" aria-label="Copy">${CopyIcon}</button>${RenderProgressBar("Checking clarity", true)}`;
		this.createButton = actions.querySelector<HTMLButtonElement>("[data-create-synoptic-view]")!;
		this.copyButton = actions.querySelector<HTMLButtonElement>("[data-copy-synoptic-view]")!;
		this.progress = actions.querySelector<HTMLElement>(".progress-bar")!;
		this.progress.dataset.synopticViewProgress = "";
		this.editor = new MarkdownEditor(dream.synopticView, "Clarity Check", this.HandleChange.bind(this), errors, false, "See what the model can presently discern in your Signals and Reflections.", "dreamSynopticViewHeight");
		this.editor.Root.classList.add("dream-synoptic-view-markdown");
		this.editor.Root.dataset.dreamSynopticView = "";
		this.Root.append(actions, this.editor.Root);
		this.Root.addEventListener("click", this.clickHandler);
		this.Update(dream);
	}

	public override Dispose(): void
	{
		this.Root.removeEventListener("click", this.clickHandler);
		this.editor.Dispose();
		super.Dispose();
	}

	public Update(dream: DreamView): void
	{
		this.editor.SetMarkdown(dream.synopticView);
		const generating = this.clarity.IsCreatingSynopticView(dream.id);
		this.createButton.innerHTML = generating ? CloseIcon : IlluminateIcon;
		this.createButton.title = generating ? "Cancel" : "Check clarity";
		this.createButton.setAttribute("aria-label", generating ? "Cancel" : "Check clarity");
		this.createButton.dataset.createSynopticView = generating ? "cancel" : "start";
		this.createButton.disabled = !generating && !this.clarity.CanCreateSynopticView(dream);
		this.copyButton.disabled = dream.synopticView.trim().length === 0;
		this.progress.hidden = !generating;
		this.Root.setAttribute("aria-busy", String(generating));
	}

	private HandleChange(markdown: string): void
	{
		this.controller.UpdateSynopticView(markdown);
		this.copyButton.disabled = markdown.trim().length === 0;
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const create = target?.closest<HTMLButtonElement>("[data-create-synoptic-view]");
		if (create !== null && create !== undefined)
		{
			if (create.dataset.createSynopticView === "cancel") void this.clarity.CancelSynopticViewAsync();
			else if (this.editor.GetMarkdown().trim().length === 0 || window.confirm("Replace the current Clarity Check?")) void this.clarity.CreateSynopticViewAsync();
			return;
		}
		if (target?.closest("[data-copy-synoptic-view]") !== null) void this.CopyAsync();
	}

	private async CopyAsync(): Promise<void>
	{
		try
		{
			await this.exports.CopySynopticViewAsync();
		}
		catch (error)
		{
			this.errors.Report("DreamSynopticViewPanel", error, "The Clarity Check could not be copied.");
		}
	}
}
