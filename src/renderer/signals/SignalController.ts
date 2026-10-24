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
		this.events?.Subscribe("signal.selection-add-requested", this.HandleSelectionAddRequestedAsync.bind(this));
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
					selections: [selection],
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
					selections: existing.selections,
					description
				});
			const applyAsync = this.ApplySavedDescriptionAsync.bind(this);
			const report = this.ReportDescriptionSaveError.bind(this);
			await this.descriptionSaves.RequestAsync(signalId, description, saveAsync, applyAsync, report);
		}
	}

	// Persists the reader-authored title for one Signal.
	public async UpdateTitleAsync(signalId: string, title: string): Promise<void>
	{
		const existing = this.store.GetSignal(signalId);
		const normalized = title.trim();

		if (existing !== null && normalized.length > 0)
		{
			try
			{
				const saved = await this.gateway.SaveAsync({
					signalId: existing.id,
					workId: existing.workId,
					title: normalized,
					selections: existing.selections,
					description: existing.description
				});
				this.store.Replace(saved);
				await this.events?.PublishAsync("signal.changed", { signal: saved });
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to rename this Signal.");
			}
		}
	}

	// Removes one exact passage while preserving the requirement that every Signal remains anchored.
	public async RemoveSelectionAsync(signalId: string, selectionIndex: number): Promise<void>
	{
		const existing = this.store.GetSignal(signalId);

		if (existing === null)
		{
			this.errors.Report("SignalController", new Error(`Signal does not exist: ${signalId}`), "Unable to remove this passage.");
		}
		else if (existing.selections.length <= 1)
		{
			this.errors.Report("SignalController", new Error("A Signal must retain at least one passage."), "The final passage cannot be removed.");
		}
		else if (selectionIndex < 0 || selectionIndex >= existing.selections.length)
		{
			this.errors.Report("SignalController", new Error(`Signal passage does not exist: ${selectionIndex}`), "Unable to remove this passage.");
		}
		else
		{
			try
			{
				const selections = existing.selections.filter((_selection, index) => index !== selectionIndex);
				const title = existing.title === undefined ? {} : { title: existing.title };
				const saved = await this.gateway.SaveAsync({
					signalId: existing.id,
					workId: existing.workId,
					...title,
					selections,
					description: existing.description
				});
				this.store.Replace(saved);
				await this.events?.PublishAsync("signal.changed", { signal: saved });
				await this.events?.PublishAsync("library.jump-requested", { selections: saved.selections, target: "signal" });
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to remove this passage.");
			}
		}
	}

	// Adds another exact source component to one existing Signal.
	public async AddSelectionAsync(signalId: string, selection: TextSelection): Promise<void>
	{
		const existing = this.store.GetSignal(signalId);

		if (existing === null)
		{
			this.errors.Report("SignalController", new Error(`Signal does not exist: ${signalId}`), "Unable to add this selection to the Signal.");
		}
		else if (selection.documentId !== existing.workId || !IsValidSignalSelection(selection))
		{
			this.errors.Report("SignalController", new Error("Signal component belongs to another work or is empty."), "Select text from the Signal's work.");
		}
		else
		{
			try
			{
				const saved = await this.gateway.SaveAsync({
					signalId: existing.id,
					workId: existing.workId,
					selections: [...existing.selections, selection],
					description: existing.description
				});
				this.store.Replace(saved);
				await this.events?.PublishAsync("signal.changed", { signal: saved });
				await this.events?.PublishAsync("library.jump-requested", { selections: saved.selections, target: "signal" });
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to add this selection to the Signal.");
			}
		}
	}

	// Deletes one Signal from every Dream and Idea that references it.
	public async DeleteEverywhereAsync(signalId: string): Promise<boolean>
	{
		const existing = this.store.GetSignal(signalId);
		let deleted = false;

		if (existing === null)
		{
			this.errors.Report("SignalController", new Error(`Signal does not exist: ${signalId}`), "Unable to delete this Signal.");
		}
		else
		{
			try
			{
				await this.gateway.DeleteAsync({ signalId, workId: existing.workId });
				this.store.Remove(signalId);
				await this.events?.PublishAsync("signal.deleted", { signalId, workId: existing.workId });
				deleted = true;
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to delete this Signal everywhere.");
			}
		}

		return deleted;
	}

	// Routes composition requests from the reader context menu.
	private async HandleSelectionAddRequestedAsync(event: ChoraEvents["signal.selection-add-requested"]): Promise<void>
	{
		await this.AddSelectionAsync(event.signalId, event.selection);
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
