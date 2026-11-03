import type { DreamView } from "./DreamView.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { SignalViewPanel, type SignalPassageKind } from "../signals/SignalViewPanel.js";
import { DreamController } from "./DreamController.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalController } from "../signals/SignalController.js";

// Presents Signals associated with the active Dream.
export class DreamSignalsPanel extends SignalViewPanel
{
	private dreamId: string | null = null;
	private dreamSource: TextSelection | null = null;
	private document: TextDocument | null = null;

	public constructor(
		private readonly controller: DreamController,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly signals: SignalController | null,
		errors: ErrorManager)
	{
		super(errors);
		this.Root.classList.add("dream-signals-panel");
	}

	public Update(dream: DreamView, document: TextDocument | null): void
	{
		this.dreamId = dream.id;
		this.dreamSource = structuredClone(dream.source);
		this.document = document;
		this.UpdateSignals(dream.signals, document);
	}

	protected GetPassageKind(selection: TextSelection): SignalPassageKind
	{
		const kind = this.document !== null
			&& this.dreamSource !== null
			&& this.document.id === selection.dialogue
			&& this.document.Contains(selection, this.dreamSource)
			? "source"
			: "external";

		return kind;
	}

	protected GetRememberedSignal(): string | null
	{
		const signalId = this.dreamId === null
			? null
			: this.controller.GetSelectedSignal(this.dreamId);

		return signalId;
	}

	protected RememberSignal(signalId: string | null): void
	{
		if (this.dreamId !== null) this.controller.RememberSelectedSignal(this.dreamId, signalId);
	}

	protected async ViewSignalAsync(signalId: string): Promise<void>
	{
		await this.controller.ViewSignalAsync(signalId);
	}

	protected ViewSignalSelection(selection: TextSelection): void
	{
		void this.events.PublishAsync("library.jump-requested", { selection, target: "signal" });
	}

	protected DeleteSignalAsync(signalId: string): Promise<boolean>
	{
		const deletion = this.signals === null
			? Promise.resolve(false)
			: this.signals.DeleteAsync(signalId);

		return deletion;
	}

	protected UpdateSignalDescription(signalId: string, description: string): void
	{
		void this.signals?.UpdateDescriptionAsync(signalId, description);
	}

	protected UpdateSignalTitle(signalId: string, title: string): void
	{
		void this.signals?.UpdateTitleAsync(signalId, title);
	}

	protected RemoveSignalSelection(signalId: string, selectionIndex: number): void
	{
		void this.signals?.RemoveSelectionAsync(signalId, selectionIndex);
	}
}
