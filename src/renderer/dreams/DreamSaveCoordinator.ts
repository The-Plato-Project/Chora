import { CreateDreamView } from "./DreamView.js";
import { CreateDreamUpdateCommand } from "./DreamView.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { DreamGateway } from "./DreamGateway.js";
import { DreamStore, type DreamChange, type DreamSaveState } from "./DreamStore.js";

import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";

// Owns Dream save ordering, autosave timing, revision checks, and suspension during deletion.
export class DreamSaveCoordinator
{
	// Delay before an idle edit is persisted.
	private static readonly AutosaveDelayMilliseconds = 750;
	// Pending autosave clock, owned only by this coordinator.
	private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	// Single renderer save currently awaiting main-process persistence.
	private activeSave: Promise<void> | null = null;
	// Dream identities temporarily excluded from saving while deletion finishes.
	private readonly suspended = new Set<string>();
	// Prevents autosave from restarting after application disposal.
	private isDisposed = false;

	// Uses the existing DreamStore and IPC gateway without maintaining a second editing snapshot.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager, private readonly store: DreamStore, private readonly gateway: DreamGateway)
	{
	}

	// Saves the active DreamView, then saves once more if a concurrent edit left it dirty, then reschedules autosave.
	public async SaveAsync(): Promise<boolean>
	{
		this.CancelAutosave();
		await this.RunPendingSaveAsync();
		await this.RunCatchUpSaveIfDirtyAsync();

		if (this.store.GetIsDirty() && this.store.GetSaveState() !== "error") this.ScheduleAutosave();
		const completed = !this.store.GetIsDirty() && this.store.GetSaveState() !== "error";

		return completed;
	}

	// Coordinates events and autosave after a store-owned DreamView mutation.
	public HandleDreamChange(change: DreamChange | null): void
	{
		if (change !== null)
		{
			if (change.becameDirty)
			{
				void this.events.PublishAsync("dream.changed", {});
			}
			this.ScheduleAutosave();
		}
	}

	// Persists the captured Dream revision and applies its response only through the state owner.
	private async PerformSaveAsync(): Promise<void>
	{
		const activeDream = this.store.GetActiveDream();

		if (activeDream !== null && !this.suspended.has(activeDream.id) && !this.isDisposed)
		{
			const revision = this.store.GetRevision();
			const dream = structuredClone(activeDream);
			dream.updatedAt = new Date().toISOString();
			this.SetSaveState(dream.id, "saving");

			try
			{
				const command = CreateDreamUpdateCommand(dream);
				const savedSnapshot = await this.gateway.UpdateAsync(command);
				const savedDream = CreateDreamView(savedSnapshot);
				if (!this.isDisposed)
				{
					this.store.MarkSaved(savedDream, revision);
					await this.events.PublishAsync("dream.saved", {});
				}
			}

			catch (error)
			{
				this.SetSaveState(dream.id, "error");
				this.errors.Report("DreamSaveCoordinator", error, "The Dream could not be saved. Your edits remain in the editor; retry Save after resolving the problem.");
			}
		}
	}

	// Starts an immediate save when none is already in flight, otherwise waits for the one already running.
	private async RunPendingSaveAsync(): Promise<void>
	{
		if (this.activeSave === null) this.activeSave = this.PerformSaveAsync();
		await this.WaitForIdleAsync();
	}

	// Saves once more when a concurrent edit left the DreamView dirty after the pending save completed.
	private async RunCatchUpSaveIfDirtyAsync(): Promise<void>
	{
		if (this.store.GetIsDirty() && this.store.GetSaveState() !== "error" && this.activeSave === null)
		{
			this.activeSave = this.PerformSaveAsync();
			await this.WaitForIdleAsync();
		}
	}

	// Schedules persistence after an idle editing interval while this owner is alive.
	public ScheduleAutosave(): void
	{
		this.CancelAutosave();
		if (!this.isDisposed) this.autosaveTimer = setTimeout(this.HandleAutosaveTimer.bind(this), DreamSaveCoordinator.AutosaveDelayMilliseconds);
	}

	// Clears the pending autosave timer and starts the deferred save.
	private HandleAutosaveTimer(): void
	{
		this.autosaveTimer = null;
		void this.SaveAsync();
	}

	// Cancels a pending autosave timer, if one is scheduled.
	public CancelAutosave(): void
	{
		if (this.autosaveTimer !== null)
		{
			clearTimeout(this.autosaveTimer);
			this.autosaveTimer = null;
		}
	}

	// Records and publishes a change to the active DreamView's save-state lifecycle.
	private SetSaveState(dreamId: string, state: DreamSaveState): void
	{
		this.store.SetSaveState(dreamId, state);
		void this.events.PublishAsync("dream.save-state-changed", {});
	}

	// Drains the captured write before close or delete proceeds, without clearing a later write.
	public async WaitForIdleAsync(): Promise<void>
	{
		const pending = this.activeSave;
		try
		{
			await pending;
		}
		finally
		{
			if (this.activeSave === pending) this.activeSave = null;
		}
	}

	// Reports active persistence or deletion admission to reconciliation.
	public IsBusy(): boolean
	{
		const busy = this.activeSave !== null || this.suspended.size > 0;
		return busy;
	}

	// Stops pending saves and drains the current write before the caller deletes its Dream.
	public async SuspendAsync(dreamId: string): Promise<() => void>
	{
		if (this.suspended.has(dreamId)) throw ApplicationError.Expected("conflict", "DREAM_BUSY", "This Dream already has an operation in progress.");
		this.suspended.add(dreamId);
		this.CancelAutosave();
		try
		{
			await this.activeSave;
		}
		catch (error)
		{
			this.suspended.delete(dreamId);
			throw error;
		}
		const suspended = this.suspended;
		// Releases only this Dream's deletion admission.
		function Resume(): void
		{
			suspended.delete(dreamId);
		}
		return Resume;
	}

	// Releases the clock; completed in-flight writes cannot restart autosave after shutdown.
	public Dispose(): void
	{
		this.isDisposed = true;
		this.CancelAutosave();
	}
}
