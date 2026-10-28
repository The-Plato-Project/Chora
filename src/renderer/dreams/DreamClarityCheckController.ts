import { CreateDreamSnapshot, type DreamView } from "./DreamView.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { DreamMarkdownExport } from "../../shared/dreams/DreamMarkdownExport.js";
import { DreamGateway } from "./DreamGateway.js";
import { DreamStore } from "./DreamStore.js";

import type { DreamSaveCoordinator } from "./DreamSaveCoordinator.js";

// Owns Clarity Check requests, cancellation, and revision-aware result application.
export class DreamClarityCheckController
{
	// Requests in flight, keyed by the Dream whose material was submitted.
	private readonly creatingSynopticViewDreamIds = new Set<string>();
	// Explicit reader cancellations awaiting completion of the provider call.
	private readonly cancelledSynopticViewDreamIds = new Set<string>();
	// Prevents late results from applying after disposal.
	private isDisposed = false;

	// Shares the canonical renderer store and save coordinator with Dream editing.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager, private readonly library: LibraryStore, private readonly store: DreamStore, private readonly gateway: DreamGateway, private readonly saves: DreamSaveCoordinator)
	{
	}

	// Reports whether the reader has supplied observations for a Clarity Check.
	public CanCreateSynopticView(dream: DreamView): boolean
	{
		const hasObservations = dream.signals.some(function HasObservation(signal): boolean
		{
			return signal.description.trim().length > 0;
		});
		const canCreate = dream.reflection.trim().length > 0 || hasObservations;
		return canCreate;
	}

	// Reports the request state of one Dream without duplicating editing state.
	public IsCreatingSynopticView(dreamId: string): boolean
	{
		const creating = this.creatingSynopticViewDreamIds.has(dreamId);
		return creating;
	}

	// Runs one request for a captured Dream revision and applies only a current, uncancelled response.
	public async CreateSynopticViewAsync(): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		if (!this.isDisposed && dream !== null && !this.creatingSynopticViewDreamIds.has(dream.id))
		{
			if (!this.CanCreateSynopticView(dream))
			{
				this.errors.Report("DreamClarityCheckController", new Error("The Dream has no reader-authored observations."), "Add a Signal observation or Reflection before checking clarity.");
			}
			else
			{
				const dreamId = dream.id;
				const revision = this.store.GetRevision();
				this.creatingSynopticViewDreamIds.add(dreamId);
				this.cancelledSynopticViewDreamIds.delete(dreamId);
				await this.events.PublishAsync("dream.synoptic-view-state-changed", { dreamId });
				try
				{
					const document = this.library.GetText();

					if (document === null || document.id !== dream.workId)
					{
						throw new Error("The Dream source document is not open.");
					}

					const snapshot = CreateDreamSnapshot(dream);
					const readingDocument = DreamMarkdownExport.SerializeForSynopticView(snapshot, document);
					const synopticView = await this.gateway.CreateSynopticViewAsync({ dreamId, readingDocument });
					const current = this.store.GetActiveDream();
					if (!this.isDisposed && !this.cancelledSynopticViewDreamIds.has(dreamId) && current?.id === dreamId && this.store.GetRevision() === revision)
					{
						const change = this.store.UpdateSynopticView(synopticView);
						this.saves.HandleDreamChange(change);
					}
					else if (!this.isDisposed && !this.cancelledSynopticViewDreamIds.has(dreamId))
					{
						this.errors.Report("DreamClarityCheckController", new Error("The Dream changed while its Clarity Check was being generated."), "The Clarity Check was not applied because the Dream changed.");
					}
				}
				catch (error)
				{
					if (!this.cancelledSynopticViewDreamIds.has(dreamId)) this.errors.Report("DreamClarityCheckController", error, "Unable to complete the Clarity Check.");
				}
				finally
				{
					this.creatingSynopticViewDreamIds.delete(dreamId);
					this.cancelledSynopticViewDreamIds.delete(dreamId);
					await this.events.PublishAsync("dream.synoptic-view-state-changed", { dreamId });
				}
			}
		}
	}

	// Cancels only the active Dream request and retains its current reader-authored result.
	public async CancelSynopticViewAsync(): Promise<void>
	{
		const dreamId = this.store.GetActiveDream()?.id;
		if (dreamId !== undefined && this.creatingSynopticViewDreamIds.has(dreamId))
		{
			this.cancelledSynopticViewDreamIds.add(dreamId);
			try
			{
				await this.gateway.CancelSynopticViewAsync(dreamId);
			}
			catch (error)
			{
				this.cancelledSynopticViewDreamIds.delete(dreamId);
				this.errors.Report("DreamClarityCheckController", error, "Unable to cancel the Clarity Check.");
			}
		}
	}

	// Reports model operations that would conflict with catalogue reconciliation.
	public HasActiveRequests(): boolean
	{
		const active = this.creatingSynopticViewDreamIds.size > 0;
		return active;
	}

	// Cancels outstanding requests without applying their later results to a disposed store.
	public Dispose(): void
	{
		this.isDisposed = true;
		for (const dreamId of this.creatingSynopticViewDreamIds)
		{
			this.cancelledSynopticViewDreamIds.add(dreamId);
			void this.CancelOnDisposeAsync(dreamId);
		}
	}

	// Captures cancellation failures during shutdown without creating a new user workflow.
	private async CancelOnDisposeAsync(dreamId: string): Promise<void>
	{
		try
		{
			await this.gateway.CancelSynopticViewAsync(dreamId);
		}
		catch (error)
		{
			this.errors.Capture("DreamClarityCheckController.Dispose", error);
		}
	}
}
