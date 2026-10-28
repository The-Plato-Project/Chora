import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";
import { IsValidSignalSelection } from "../../shared/signals/SignalSelection.js";
import { OrderSignalsByText } from "../../shared/signals/SignalOrder.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { DreamStore } from "../dreams/DreamStore.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import { SignalGateway } from "./SignalGateway.js";
import { SignalDescriptionSaveQueue } from "./SignalDescriptionSaveQueue.js";

// Coordinates every renderer Signal workflow through one Dream-owned API.
export class SignalController
{
	// Serializes description persistence so stale responses cannot replace active editor state.
	private readonly descriptionSaves = new SignalDescriptionSaveQueue();

	// Creates the sole renderer workflow owner for Signal commands.
	public constructor(
		private readonly errors: ErrorManager,
		private readonly dreams: DreamStore,
		private readonly library: LibraryStore,
		private readonly gateway: SignalGateway,
		private readonly events: ChoraEventBus<ChoraEvents>)
	{
		this.events.Subscribe("dream.signal-add-requested", this.HandleCreateRequestedAsync.bind(this));
		this.events.Subscribe("signal.selection-add-requested", this.HandleSelectionAddRequestedAsync.bind(this));
	}

	// Reports descriptions still being saved or retained after a failed save.
	public HasUncommittedChanges(): boolean
	{
		const pending = this.descriptionSaves.HasUncommittedChanges();

		return pending;
	}

	// Creates and selects one Signal inside the active Dream without navigating.
	public async CreateAsync(selection: TextSelection): Promise<SignalRecord | null>
	{
		const dream = this.dreams.GetActiveDream();
		const document = this.library.GetText();
		let signal: SignalRecord | null = null;

		if (dream === null)
		{
			this.errors.Report("SignalController", new Error("No active Dream."), "Open a Dream before adding a Signal.");
		}
		else if (document === null || document.id !== dream.workId || !document.Contains(selection, dream.source))
		{
			this.errors.Report("SignalController", new Error("Selection outside the Dream source."), "Select text inside the active Dream source.");
		}
		else if (!IsValidSignalSelection(selection))
		{
			this.errors.Report("SignalController", new Error("Signal selection is empty."), "Select text before creating a Signal.");
		}
		else if (!dream.signals.some(function HasSelection(candidate): boolean
		{
			return candidate.selections.some(function Matches(existing): boolean
			{
				return JSON.stringify(existing) === JSON.stringify(selection);
			});
		}))
		{
			try
			{
				signal = await this.gateway.CreateAsync({ dreamId: dream.id, selection });
				this.dreams.SetSelectedSignal(dream.id, signal.id);
				this.ApplySignal(dream.id, signal);
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to create this Signal.");
			}
		}

		return signal;
	}

	// Persists one Signal description through the same update API as every other Signal edit.
	public async UpdateDescriptionAsync(signalId: string, description: string): Promise<void>
	{
		const context = this.GetSignalContext(signalId);

		if (context !== null)
		{
			const command = this.CreateUpdateCommand(context.dream.id, context.signal, { description });
			const saveAsync = this.gateway.UpdateAsync.bind(this.gateway, command);
			const applyAsync = this.ApplySavedSignalAsync.bind(this);
			const report = this.ReportDescriptionSaveError.bind(this);
			await this.descriptionSaves.RequestAsync(signalId, description, saveAsync, applyAsync, report);
		}
	}

	// Persists the reader-authored title for one Signal.
	public async UpdateTitleAsync(signalId: string, title: string): Promise<void>
	{
		const context = this.GetSignalContext(signalId);
		const normalized = title.trim();

		if (context !== null && normalized.length > 0)
		{
			const command = this.CreateUpdateCommand(context.dream.id, context.signal, { title: normalized });
			await this.UpdateAsync(command, "Unable to rename this Signal.");
		}
	}

	// Removes one exact passage while retaining at least one passage.
	public async RemoveSelectionAsync(signalId: string, selectionIndex: number): Promise<void>
	{
		const context = this.GetSignalContext(signalId);

		if (context === null)
		{
			this.errors.Report("SignalController", new Error(`Signal does not exist: ${signalId}`), "Unable to remove this passage.");
		}
		else if (context.signal.selections.length <= 1)
		{
			this.errors.Report("SignalController", new Error("A Signal must retain at least one passage."), "The final passage cannot be removed.");
		}
		else if (selectionIndex < 0 || selectionIndex >= context.signal.selections.length)
		{
			this.errors.Report("SignalController", new Error(`Signal passage does not exist: ${selectionIndex}`), "Unable to remove this passage.");
		}
		else
		{
			const selections = context.signal.selections.filter(function KeepSelection(_selection, index): boolean
			{
				return index !== selectionIndex;
			});
			const command = this.CreateUpdateCommand(context.dream.id, context.signal, { selections });
			await this.UpdateAsync(command, "Unable to remove this passage.");
		}
	}

	// Adds another exact passage from the owning Signal's work.
	public async AddSelectionAsync(signalId: string, selection: TextSelection): Promise<void>
	{
		const context = this.GetSignalContext(signalId);

		if (context === null)
		{
			this.errors.Report("SignalController", new Error(`Signal does not exist: ${signalId}`), "Unable to add this passage.");
		}
		else if (selection.documentId !== context.signal.workId || !IsValidSignalSelection(selection))
		{
			this.errors.Report("SignalController", new Error("Signal passage belongs to another work or is empty."), "Select text from the Signal's work.");
		}
		else
		{
			const selections = [...context.signal.selections, selection];
			const command = this.CreateUpdateCommand(context.dream.id, context.signal, { selections });
			await this.UpdateAsync(command, "Unable to add this passage.");
		}
	}

	// Deletes one Signal from its sole owning Dream.
	public async DeleteAsync(signalId: string): Promise<boolean>
	{
		const context = this.GetSignalContext(signalId);
		let deleted = false;

		if (context === null)
		{
			this.errors.Report("SignalController", new Error(`Signal does not exist: ${signalId}`), "Unable to delete this Signal.");
		}
		else
		{
			try
			{
				await this.gateway.DeleteAsync({ signalId, dreamId: context.dream.id });
				this.dreams.RemoveOwnedSignal(context.dream.id, signalId);
				await this.events.PublishAsync("dream.structure-changed", { dreamId: context.dream.id });
				deleted = true;
			}
			catch (error)
			{
				this.errors.Report("SignalController", error, "Unable to delete this Signal.");
			}
		}

		return deleted;
	}

	// Routes both text surfaces through the same Signal creation workflow.
	private async HandleCreateRequestedAsync(event: ChoraEvents["dream.signal-add-requested"]): Promise<void>
	{
		await this.CreateAsync(event.selection);
	}

	// Routes composition requests through the sole Signal update workflow.
	private async HandleSelectionAddRequestedAsync(event: ChoraEvents["signal.selection-add-requested"]): Promise<void>
	{
		await this.AddSelectionAsync(event.signalId, event.selection);
	}

	// Updates one Signal and applies the canonical response without navigation side effects.
	private async UpdateAsync(command: UpdateSignalCommand, failureMessage: string): Promise<void>
	{
		try
		{
			const saved = await this.gateway.UpdateAsync(command);
			this.ApplySignal(command.dreamId, saved);
		}
		catch (error)
		{
			this.errors.Report("SignalController", error, failureMessage);
		}
	}

	// Applies a queued canonical description result.
	private async ApplySavedSignalAsync(saved: SignalRecord): Promise<void>
	{
		this.ApplySignal(saved.dreamId, saved);
		await Promise.resolve();
	}

	// Applies one canonical Signal and preserves main-passage ordering.
	private ApplySignal(dreamId: string, signal: SignalRecord): void
	{
		const dream = this.dreams.GetActiveDream();
		const document = this.library.GetText();

		if (dream !== null && dream.id === dreamId)
		{
			const signals = dream.signals.filter(function ExcludeSaved(candidate): boolean
			{
				return candidate.id !== signal.id;
			});
			signals.push(signal);
			const ordered = OrderSignalsByText(document, signals);
			this.dreams.SetOwnedSignals(dreamId, ordered);
			void this.events.PublishAsync("dream.structure-changed", { dreamId });
		}
	}

	// Returns the active Dream and one Signal it owns.
	private GetSignalContext(signalId: string): { dream: NonNullable<ReturnType<DreamStore["GetActiveDream"]>>; signal: SignalRecord } | null
	{
		const dream = this.dreams.GetActiveDream();
		const signal = dream?.signals.find(function FindSignal(candidate): boolean
		{
			return candidate.id === signalId;
		}) ?? null;
		const context = dream === null || signal === null ? null : { dream, signal };

		return context;
	}

	// Builds a complete update command while preserving unspecified Signal fields.
	private CreateUpdateCommand(
		dreamId: string,
		signal: SignalRecord,
		changes: { readonly title?: string; readonly selections?: readonly TextSelection[]; readonly description?: string }): UpdateSignalCommand
	{
		const title = changes.title ?? signal.title;
		const titleField = title === undefined ? {} : { title };
		const command: UpdateSignalCommand = {
			dreamId,
			signalId: signal.id,
			...titleField,
			selections: changes.selections ?? signal.selections,
			description: changes.description ?? signal.description
		};

		return command;
	}

	// Reports persistence failure without replacing active local text.
	private ReportDescriptionSaveError(error: unknown): void
	{
		this.errors.Report("SignalController", error, "Unable to save this Signal.");
	}
}
