import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { IsValidSignalSelection } from "../../shared/signals/SignalSelection.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { SignalGateway } from "./SignalGateway.js";
import { SignalDescriptionSaveQueue } from "./SignalDescriptionSaveQueue.js";
import { SignalStore } from "./SignalStore.js";

// Coordinates shared Signal loading, creation, and editing.
export class SignalController
{
	// Serializes description persistence so stale responses cannot replace active editor state.
	private readonly descriptionSaves = new SignalDescriptionSaveQueue();

	public constructor(
		private readonly errors: ErrorManager,
		private readonly store: SignalStore,
		private readonly gateway: SignalGateway,
		private readonly events: ChoraEventBus<ChoraEvents> | null = null)
	{
	}

	// Loads the active work's Signals.
	public async LoadAsync(workId: string): Promise<void>
	{
		try
		{
			const signals = await this.gateway.ListAsync(workId);
			this.store.SetWork(workId, signals);
		}
		catch (error)
		{
			this.errors.Report("SignalController", error, "Unable to load Signals.");
		}
	}

	// Creates one work-owned Signal from an exact text selection.
	public async CreateAsync(selection: TextSelection): Promise<SignalRecord | null>
	{
		let signal: SignalRecord | null = null;

		if (!IsValidSignalSelection(selection))
		{
			this.errors.Report(
				"SignalController",
				new Error("Signal selections must not be empty."),
				"Select text before creating a Signal.");
		}
		else
		{
			try
			{
				signal = await this.gateway.SaveAsync({
					signalId: null,
					workId: selection.documentId,
					selection,
					description: ""
				});
				this.store.Replace(signal);
				await this.events?.PublishAsync("signal.changed", { signal });
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to create this Signal.");
			}
		}

		return signal;
	}

	// Persists one Signal description without changing its associations.
	public async UpdateDescriptionAsync(signalId: string, description: string): Promise<void>
	{
		const existing = this.store.GetSignal(signalId);

		if (existing !== null)
		{
			const saveAsync = this.gateway.SaveAsync.bind(this.gateway, {
					signalId: existing.id,
					workId: existing.workId,
					selection: existing.selection,
					description
				});
			const applyAsync = this.ApplySavedDescriptionAsync.bind(this);
			const report = this.ReportDescriptionSaveError.bind(this);
			await this.descriptionSaves.RequestAsync(signalId, description, saveAsync, applyAsync, report);
		}
	}

	// Applies only the newest canonical description returned by the serialized writer.
	private async ApplySavedDescriptionAsync(saved: SignalRecord): Promise<void>
	{
		this.store.Replace(saved);
		await this.events?.PublishAsync("signal.changed", { signal: saved });
	}

	// Reports persistence failure without replacing the active local editor state.
	private ReportDescriptionSaveError(error: unknown): void
	{
		this.errors.Report("SignalController", error, "Unable to save this Signal.");
	}
}
