import type { UpdateVisionCommand } from "../../shared/visions/VisionTypes.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { VisionGateway } from "./VisionGateway.js";
import type { VisionChange, VisionSaveState, VisionStore } from "./VisionStore.js";
import { ConcealVisionReferences } from "../../shared/visions/VisionReferenceMarkdown.js";

// Coordinates Vision editing, document lifecycle, and revision-aware persistence.
export class VisionController
{
	// Idle interval before saving a changed document.
	private static readonly AutosaveDelayMilliseconds = 750;
	// Independent autosave clocks for open documents.
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	// Active saves keyed by the document captured before IPC.
	private readonly saves = new Map<string, Promise<void>>();
	// Documents whose deletion must not race a newly scheduled save.
	private readonly deleting = new Set<string>();
	// Workflow listeners released with this controller.
	private readonly subscriptions: Unsubscribe[] = [];
	// Prevents asynchronous completion from restarting disposed workflows.
	private isDisposed = false;

	// Uses the existing state owner and stateless IPC boundary.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly store: VisionStore,
		private readonly gateway: VisionGateway)
	{
		this.subscriptions.push(events.Subscribe("workspace.save-requested", this.HandleSaveRequestedAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("workspace.blurred", this.HandleBlurredAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.reference-open-requested", this.HandleReferenceOpenRequestedAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.document-open-requested", this.HandleDocumentOpenRequested.bind(this)));
	}

	// Loads authoritative writing before restoring open documents.
	public async StartAsync(): Promise<void>
	{
		try
		{
			const catalogue = await this.gateway.ListAsync();
			if (!this.isDisposed)
			{
				this.store.SetCatalogue(catalogue);
				await this.events.PublishAsync("vision.catalogue-changed", { kind: "reset" });
				if (this.store.GetActive() !== null)
				{
					await this.events.PublishAsync("vision.opened", {});
				}
			}
		}
		catch (error)
		{
			this.errors.Report("VisionController", error, "Visions could not be loaded.");
		}
	}

	// Creates an independent writing document and opens its tab.
	public async CreateAsync(workId: string, folderPath = ""): Promise<void>
	{
		try
		{
			const vision = await this.gateway.CreateAsync({ workId, folderPath });
			if (!this.isDisposed)
			{
				this.store.AddSaved(vision);
				this.store.Open(vision.id);
				await this.events.PublishAsync("vision.catalogue-changed", { kind: "created", visionId: vision.id, workId });
				await this.events.PublishAsync("vision.opened", {});
			}
		}
		catch (error)
		{
			this.errors.Report("VisionController", error, "The Vision could not be created.");
		}
	}

	public async CreateFolderAsync(workId: string, parentPath: string, name: string): Promise<boolean>
	{
		try
		{
			const folder = await this.gateway.CreateFolderAsync({ workId, parentPath, name });
			if (!this.isDisposed)
			{
				this.store.AddFolder(folder);
				await this.events.PublishAsync("vision.catalogue-changed", {
					kind: "folder-created", workId, folderPath: folder.path
				});
			}
			return true;
		}
		catch (error)
		{
			this.errors.Report("VisionController", error, "The Vision folder could not be created.");
			return false;
		}
	}

	public async DeleteFolderAsync(workId: string, folderPath: string): Promise<boolean>
	{
		try
		{
			await this.gateway.DeleteFolderAsync({ workId, folderPath });
			if (!this.isDisposed)
			{
				this.store.RemoveFolder(workId, folderPath);
				await this.events.PublishAsync("vision.catalogue-changed", {
					kind: "folder-deleted", workId, folderPath
				});
			}
			return true;
		}
		catch (error)
		{
			this.errors.Report("VisionController", error, "The Vision folder could not be deleted.");
			return false;
		}
	}

	public async MoveAsync(visionId: string, folderPath: string): Promise<void>
	{
		try
		{
			await this.SaveAsync(visionId);
			if (this.store.IsDirty(visionId)) return;
			const moved = await this.gateway.MoveAsync({ visionId, folderPath });
			if (!this.isDisposed)
			{
				this.store.Move(moved);
				await this.events.PublishAsync("vision.catalogue-changed", {
					kind: "moved", visionId, workId: moved.workId
				});
			}
		}
		catch (error)
		{
			this.errors.Report("VisionController", error, "The Vision could not be moved.");
		}
	}

	// Opens an existing Vision through the shared document lifecycle.
	private HandleDocumentOpenRequested(event: ChoraEvents["vision.document-open-requested"]): void
	{
		this.Open(event.visionId);
	}

	// Opens an existing Vision through the shared document lifecycle.
	public Open(visionId: string): void
	{
		this.store.Open(visionId);
		void this.events.PublishAsync("vision.opened", {});
	}

	// Activates an already open document.
	public ActivateTab(visionId: string): void
	{
		this.store.Activate(visionId);
		void this.events.PublishAsync("vision.opened", {});
	}

	// Drains the captured document's writing before removing its tab.
	public async CloseTabAsync(visionId: string): Promise<void>
	{
		await this.SaveAsync(visionId);
		if (!this.store.IsDirty(visionId))
		{
			const next = this.store.Close(visionId);
			await this.events.PublishAsync(next === null ? "vision.closed" : "vision.opened", {});
		}
	}

	// Applies reader-authored title changes without publishing a catalogue reset.
	public UpdateTitle(title: string): void
	{
		this.Update({ title });
	}

	// Stores authoritative writing synchronously before scheduling persistence.
	public UpdateMarkdown(markdown: string): void
	{
		this.Update({ markdown });
	}

	// Suspends autosave while deleting one document through its main-process owner.
	public async DeleteAsync(visionId: string): Promise<void>
	{
		const vision = this.store.Get(visionId);
		if (vision !== null && !this.deleting.has(visionId))
		{
			this.deleting.add(visionId);
			this.CancelTimer(visionId);
			try
			{
				await this.saves.get(visionId);
				await this.gateway.DeleteAsync(visionId);
				this.store.Remove(visionId);
				await this.events.PublishAsync("vision.catalogue-changed", { kind: "deleted", visionId, workId: vision.workId });
				await this.events.PublishAsync(this.store.GetActive() === null ? "vision.closed" : "vision.opened", {});
			}
			catch (error)
			{
				this.errors.Report("VisionController", error, "The Vision could not be deleted.");
			}
			finally
			{
				this.deleting.delete(visionId);
			}
		}
	}

	// Copies the current writing without waiting for autosave.
	public async CopyAsMarkdownAsync(): Promise<void>
	{
		const vision = this.store.GetActive();
		if (vision !== null)
		{
			try
			{
				await this.gateway.CopyMarkdownAsync(ConcealVisionReferences(vision.markdown));
			}
			catch (error)
			{
				this.errors.Report("VisionController", error, "The Vision could not be copied as Markdown.");
			}
		}
	}

	// Serializes saves per document while preserving newer edits and failed-save outcomes.
	public async SaveAsync(visionId = this.store.GetActive()?.id): Promise<void>
	{
		if (visionId !== undefined && !this.isDisposed && !this.deleting.has(visionId))
		{
			this.CancelTimer(visionId);
			const pending = this.saves.get(visionId);
			if (pending !== undefined)
			{
				await pending;
				if (this.store.IsDirty(visionId) && this.store.GetSaveState(visionId) !== "error")
				{
					await this.SaveAsync(visionId);
				}
			}
			else
			{
				const vision = this.store.Get(visionId);
				if (vision !== null && this.store.IsDirty(visionId) && vision.title.trim().length > 0)
				{
					const revision = this.store.GetRevision(visionId);
					const command: UpdateVisionCommand = { id: vision.id, title: vision.title.trim(), markdown: vision.markdown };
					const save = this.PerformSaveAsync(command, revision);
					this.saves.set(visionId, save);
					try
					{
						await save;
					}
					finally
					{
						this.saves.delete(visionId);
					}
					if (this.store.IsDirty(visionId) && this.store.GetSaveState(visionId) !== "error")
					{
						this.ScheduleSave(visionId);
					}
				}
			}
		}
	}

	// Releases subscriptions and pending autosave clocks.
	public Dispose(): void
	{
		this.isDisposed = true;
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
		for (const timer of this.timers.values())
		{
			clearTimeout(timer);
		}
		this.timers.clear();
	}

	// Routes editing through the store's precise mutation description.
	private Update(draft: Partial<Pick<UpdateVisionCommand, "title" | "markdown">>): void
	{
		const active = this.store.GetActive();
		if (active !== null && !this.isDisposed && !this.deleting.has(active.id))
		{
			const change = this.store.Update(active.id, draft);
			if (change !== null)
			{
				this.ScheduleSave(active.id);
				void this.PublishChangeAsync(change);
			}
		}
	}

	// Publishes only projections whose values actually changed.
	private async PublishChangeAsync(change: VisionChange): Promise<void>
	{
		const { visionId, workId } = change;
		if (change.dirtyChanged)
		{
			const isDirty = this.store.IsDirty(visionId);
			await this.events.PublishAsync("vision.dirty-changed", { visionId, workId, isDirty });
		}
		if (change.saveStateChanged)
		{
			const state = this.store.GetSaveState(visionId);
			await this.events.PublishAsync("vision.save-state-changed", { visionId, state });
		}
		if (change.titleChanged || change.updatedAtChanged)
		{
			await this.events.PublishAsync("vision.metadata-changed", {
				visionId, workId, titleChanged: change.titleChanged, updatedAtChanged: change.updatedAtChanged
			});
		}
		if (change.referenceAnchorIds.length > 0)
		{
			await this.events.PublishAsync("vision.references-changed", {
				visionId, workId, revision: change.revision, anchorIds: change.referenceAnchorIds
			});
		}
		else if (change.contextAnchorIds.length > 0)
		{
			await this.events.PublishAsync("vision.reference-context-changed", {
				visionId, workId, anchorIds: change.contextAnchorIds
			});
		}
	}

	// Resets only the changed document's autosave clock.
	private ScheduleSave(visionId: string): void
	{
		this.CancelTimer(visionId);
		if (!this.isDisposed && !this.deleting.has(visionId))
		{
			const callback = this.HandleAutosaveAsync.bind(this, visionId);
			const timer = setTimeout(callback, VisionController.AutosaveDelayMilliseconds);
			this.timers.set(visionId, timer);
		}
	}

	// Removes the fired clock before starting its asynchronous save.
	private async HandleAutosaveAsync(visionId: string): Promise<void>
	{
		this.timers.delete(visionId);
		await this.SaveAsync(visionId);
	}

	// Cancels one document's pending clock.
	private CancelTimer(visionId: string): void
	{
		const timer = this.timers.get(visionId);
		if (timer !== undefined)
		{
			clearTimeout(timer);
			this.timers.delete(visionId);
		}
	}

	// Announces save progress only when persistence status transitions.
	private async SetSaveStateAsync(visionId: string, state: VisionSaveState): Promise<void>
	{
		const changed = this.store.SetSaveState(visionId, state);
		if (changed)
		{
			await this.events.PublishAsync("vision.save-state-changed", { visionId, state });
		}
	}

	// Persists a captured revision and applies its precise resulting changes.
	private async PerformSaveAsync(command: UpdateVisionCommand, revision: number): Promise<void>
	{
		await this.SetSaveStateAsync(command.id, "saving");
		try
		{
			const saved = await this.gateway.UpdateAsync(command);
			if (!this.isDisposed)
			{
				const change = this.store.MarkSaved(command.id, saved, revision);
				await this.PublishChangeAsync(change);
			}
		}
		catch (error)
		{
			if (!this.isDisposed)
			{
				// The document owns nonmodal save feedback; keep the existing correlated diagnostic.
				this.errors.Capture("VisionController.Save", error);
				await this.SetSaveStateAsync(command.id, "error");
			}
		}
	}

	// Handles the shell's explicit persistence command.
	private async HandleSaveRequestedAsync(): Promise<void>
	{
		await this.SaveAsync();
	}

	// Saves on native blur only when no blocking dialog prevents it.
	private async HandleBlurredAsync(event: ChoraEvents["workspace.blurred"]): Promise<void>
	{
		if (event.canSave)
		{
			await this.SaveAsync();
		}
	}

	// Opens the containing document before requesting an exact placement focus.
	private async HandleReferenceOpenRequestedAsync(event: ChoraEvents["vision.reference-open-requested"]): Promise<void>
	{
		this.store.Open(event.visionId);
		await this.events.PublishAsync("vision.opened", {});
		await this.events.PublishAsync("vision.reference-focus-requested", event);
	}
}
