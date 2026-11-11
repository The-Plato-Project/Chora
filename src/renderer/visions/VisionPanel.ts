import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { MarkdownEditor } from "../ui/MarkdownEditor.js";
import { EscapeHtml } from "../ui/Html.js";
import { DialogControl } from "../ui/controls/DialogControl.js";
import { TabControl } from "../ui/controls/TabControl.js";
import { TabPanel } from "../ui/controls/TabPanel.js";
import type { VisionController } from "./VisionController.js";
import type { VisionMode, VisionStore } from "./VisionStore.js";
import { VisionMarkdownSourceEditor } from "./VisionMarkdownSourceEditor.js";

// Mode-specific content slot managed by the shared accessible tab control.
class VisionModePanel extends TabPanel
{
	// Keeps editor hosts stable while the feature replaces its active editing adapter.
	public constructor(mode: VisionMode, title: string)
	{
		super(mode, title);
		this.Root.classList.add("vision-document");
		this.Root.dataset.visionDocument = mode;
	}
}

export class VisionPanel
{
	private readonly subscriptions: Unsubscribe[] = [];
	private editor: MarkdownEditor | null = null;
	private sourceEditor: VisionMarkdownSourceEditor | null = null;
	private mode: VisionMode = "write";
	// Shared mode-tab interaction and accessible panel selection.
	private modeTabs: TabControl | null = null;
	// Standard modal form, independent of the rename command.
	private readonly renameDialog: DialogControl;
	// Captured rename identity, never inferred from a later active tab.
	private renamingVisionId: string | null = null;
	// Persistent local feedback never replaces the editor or moves its keyboard focus.
	private readonly saveNotice = document.createElement("div");
	// Explicit retry stays with the existing Vision save workflow.
	private readonly retrySaveHandler = this.RetrySaveAsync.bind(this);

	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly store: VisionStore,
		private readonly controller: VisionController)
	{
		this.renameDialog = new DialogControl(errors);
		this.saveNotice.className = "vision-save-notice";
		this.saveNotice.hidden = true;
		this.saveNotice.setAttribute("role", "status");
		const message = document.createElement("span");
		message.textContent = "Unsaved changes. The last save failed. Keep this Vision open and retry.";
		const retry = document.createElement("button");
		retry.type = "button";
		retry.className = "control-button button-control";
		retry.textContent = "Retry save";
		retry.dataset.visionRetrySave = "";
		retry.addEventListener("click", this.retrySaveHandler);
		this.saveNotice.append(message, retry);
		this.subscriptions.push(events.Subscribe("vision.opened", this.Render.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.rename-requested", this.OpenRenameDialog.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.reference-created", this.InsertReferenceAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.reference-focus-requested", this.FocusReferenceAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.closed", this.Clear.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.save-state-changed", this.UpdateSaveNotice.bind(this)));
	}

	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		this.editor?.Dispose();
		this.editor = null;
		this.sourceEditor?.Dispose();
		this.sourceEditor = null;
		this.renameDialog.Dispose();
		this.modeTabs?.Dispose();
		this.modeTabs = null;
		this.root.replaceChildren();
	}

	private Render(): void
	{
		const vision = this.store.GetActive();
		this.editor?.Dispose();
		this.editor = null;
		this.sourceEditor?.Dispose();
		this.sourceEditor = null;
		this.modeTabs?.Dispose();
		this.modeTabs = null;
		this.root.replaceChildren();
		if (vision === null) return;
		this.mode = this.store.GetEditorMode(vision.id);
		const panel = document.createElement("section");
		panel.className = "vision-panel";
		const modes = [new VisionModePanel("write", "Write"), new VisionModePanel("markdown", "Markdown"), new VisionModePanel("preview", "Preview")];
		this.modeTabs = new TabControl(modes, "Vision view", this.HandleModeSelected.bind(this));
		this.modeTabs.Root.classList.add("vision-mode-control");
		panel.append(this.saveNotice, this.modeTabs.Root);
		this.root.append(panel);
		this.modeTabs.Select(this.mode);
		this.RenderMode();
		this.UpdateSaveNotice();
	}

	// Projects save status without remounting writing adapters or opening a dialog.
	private UpdateSaveNotice(): void
	{
		const vision = this.store.GetActive();
		this.saveNotice.hidden = vision === null || this.store.GetSaveState(vision.id) !== "error";
	}

	// Captures the currently visible document before invoking its serialized save.
	private async RetrySaveAsync(): Promise<void>
	{
		const vision = this.store.GetActive();
		if (vision !== null) await this.controller.SaveAsync(vision.id);
	}

	private RenderMode(): void
	{
		const vision = this.store.GetActive();
		const host = this.root.querySelector<HTMLElement>(`[data-vision-document="${this.mode}"]`);
		if (vision === null || host === null) return;
		this.editor?.Dispose();
		this.editor = null;
		this.sourceEditor?.Dispose();
		this.sourceEditor = null;
		host.replaceChildren();
		if (this.mode === "markdown")
		{
			this.sourceEditor = new VisionMarkdownSourceEditor(
				vision.markdown,
				this.controller.UpdateMarkdown.bind(this.controller));
			host.append(this.sourceEditor.Root);
			this.sourceEditor.Focus();
		}
		else
		{
			const readOnly = this.mode === "preview";
			this.editor = new MarkdownEditor(
				vision.markdown,
				readOnly ? "Vision preview" : "Vision writing",
				this.controller.UpdateMarkdown.bind(this.controller),
				this.errors,
				readOnly,
				"Begin writing your Vision…",
				null,
				readOnly ? "hidden" : "full",
				true,
				(placement, action, relativeSelection) => this.events.PublishAsync("vision.reference-action-requested", {
					anchorId: placement.anchorId,
					action,
					...(relativeSelection !== undefined ? { relativeSelection } : {})
				}),
				(payload, requestId) => this.events.PublishAsync("vision.selection-reference-requested", {
					...payload,
					requestId
				}));
			host.append(this.editor.Root);
			void this.editor.Ready.then(() =>
			{
				if (!readOnly) this.editor?.Focus();
			});
		}
	}

	private async InsertReferenceAsync(event: ChoraEvents["vision.reference-created"]): Promise<void>
	{
		const vision = this.store.GetActive();
		if (vision === null || vision.id !== event.placement.visionId) return;
		if (this.mode !== "write" || this.editor === null)
		{
			this.errors.Report("VisionPanel", new Error("The active Vision is not in Write mode."), "Switch the Vision to Write and place the cursor where the reference belongs.");
			return;
		}
		await this.editor.Ready;
		try
		{
			this.editor.InsertVisionReference(event.placement, event.requestId);
		}
		catch (error)
		{
			this.errors.Report("VisionPanel", error, "The selected text could not be inserted at the Vision cursor.");
		}
	}

	private async FocusReferenceAsync(event: ChoraEvents["vision.reference-focus-requested"]): Promise<void>
	{
		const vision = this.store.GetActive();
		if (vision === null || vision.id !== event.visionId) return;
		if (this.mode !== "write")
		{
			this.mode = "write";
			this.store.SetEditorMode(vision.id, "write");
			void this.events.PublishAsync("vision.view-changed", {});
			this.modeTabs?.Select("write");
			this.RenderMode();
		}
		const editor = this.editor;
		if (editor === null) return;
		await editor.Ready;
		try
		{
			editor.FocusVisionReference(event.placementId);
		}
		catch (error)
		{
			this.errors.Report("VisionPanel", error, "The linked text could not be found in the Vision.");
		}
	}

	// Switches editor adapters only after the shared mode control selects a new panel.
	private HandleModeSelected(id: string): void
	{
		const mode = id as VisionMode;
		if (this.modeTabs !== null && mode !== this.mode)
		{
			this.mode = mode;
			const vision = this.store.GetActive();
			if (vision !== null) this.store.SetEditorMode(vision.id, mode);
			void this.events.PublishAsync("vision.view-changed", {});
			this.RenderMode();
		}
	}

	private OpenRenameDialog(): void
	{
		const vision = this.store.GetActive();
		if (vision !== null)
		{
			this.renamingVisionId = vision.id;
			this.renameDialog.Open({
				Title: "Rename Vision",
				Content: `<label class="control-field"><span>Vision name</span><input data-vision-rename-title value="${EscapeHtml(vision.title)}" placeholder="Untitled Vision" maxlength="200" required></label>`,
				InitialFocus: "[data-vision-rename-title]",
				CommitAsync: this.CommitRenameAsync.bind(this),
				FailureMessage: "Unable to save the Vision. Your new name remains unsaved."
			});
			const title = this.renameDialog.Content.querySelector<HTMLInputElement>("[data-vision-rename-title]");
			title?.select();
		}
	}

	// Commits a validated rename only after the shared dialog accepts the request.
	private async CommitRenameAsync(): Promise<boolean>
	{
		const visionId = this.renamingVisionId;
		const input = this.renameDialog.Content.querySelector<HTMLInputElement>("[data-vision-rename-title]");
		const title = input?.value.trim() ?? "";
		let saved = false;
		if (visionId !== null && this.store.GetActive()?.id === visionId && title.length > 0)
		{
			this.controller.UpdateTitle(title);
			await this.controller.SaveAsync(visionId);
			saved = !this.store.IsDirty(visionId) && this.store.GetSaveState(visionId) !== "error";
		}
		return saved;
	}

	private Clear(): void
	{
		this.editor?.Dispose();
		this.editor = null;
		this.sourceEditor?.Dispose();
		this.sourceEditor = null;
		this.modeTabs?.Dispose();
		this.modeTabs = null;
		this.root.replaceChildren();
	}

}
