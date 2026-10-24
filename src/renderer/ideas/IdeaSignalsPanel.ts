import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { SignalController } from "../signals/SignalController.js";
import { SignalViewPanel, type SignalViewRecord } from "../signals/SignalViewPanel.js";
import { IdeaController } from "./IdeaController.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";

// Provides selected-Signal state owned by the Idea editor.
export interface IdeaSignalViewOwner
{
	// Returns the Signal remembered by the active Idea editor.
	GetSelectedIdeaSignal(): string | null;
	// Remembers the selected Signal for the active Idea editor.
	RememberSelectedIdeaSignal(signalId: string | null): void;
	// Publishes the active Signal for source-selection composition.
	NotifyActiveIdeaSignal(signalId: string | null, selections: readonly TextSelection[]): void;
	// Navigates to one exact passage inside the selected Signal.
	ViewIdeaSignalSelection(selection: TextSelection): void;
	// Opens the Idea's existing-Signal discovery workflow.
	OpenIdeaSignalBrowser(): void;
}

// Adapts the shared Signal view to Idea associations.
export class IdeaSignalsPanel extends SignalViewPanel
{
	// Connects common Signal presentation to Idea workflows.
	public constructor(
		private readonly controller: IdeaController,
		private readonly signals: SignalController | null,
		private readonly owner: IdeaSignalViewOwner,
		errors: ErrorManager)
	{
		super(errors, true, false);
		this.Root.classList.add("idea-signals-panel");
	}

	// Reconciles resolved Signals associated with the Idea.
	public Update(signals: readonly SignalViewRecord[], document: TextDocument | null): void
	{
		this.UpdateSignals(signals, document);

		for (const signal of signals)
		{
			this.UpdateRationale(signal.id);
		}
	}

	// Reconciles one Idea-owned rationale without changing the shared Signal description.
	private UpdateRationale(signalId: string): void
	{
		const row = this.Root.querySelector<HTMLElement>(`[data-signal-id="${CSS.escape(signalId)}"]`);
		const body = row?.querySelector<HTMLElement>(".signal-detail-body");
		const rationale = this.controller.GetSignalRationale(signalId);
		let context = body?.querySelector<HTMLElement>(".idea-signal-rationale") ?? null;

		if (body !== null && body !== undefined && rationale !== null)
		{
			if (context === null)
			{
				context = document.createElement("aside");
				context.className = "idea-signal-rationale";
				context.innerHTML = "<strong>Why this Signal connects</strong><p></p>";
				body.prepend(context);
			}
			const text = context.querySelector<HTMLElement>("p");
			if (text !== null) text.textContent = rationale;
		}
		else
		{
			context?.remove();
		}
	}

	// Returns the Idea editor's remembered Signal.
	protected GetRememberedSignal(): string | null
	{
		const signalId = this.owner.GetSelectedIdeaSignal();

		return signalId;
	}

	// Stores the active Idea Signal selection.
	protected RememberSignal(signalId: string | null): void
	{
		this.owner.RememberSelectedIdeaSignal(signalId);
	}

	// Publishes the active Signal for source-selection composition.
	protected NotifyActiveSignal(signalId: string | null, selections: readonly TextSelection[]): void
	{
		this.owner.NotifyActiveIdeaSignal(signalId, selections);
	}

	// Navigates the reader to one Idea Signal.
	protected async ViewSignalAsync(signalId: string): Promise<void>
	{
		await this.controller.ViewSignalAsync({ signalId });
	}

	// Navigates to one exact component without changing the selected Signal.
	protected ViewSignalSelection(selection: TextSelection): void
	{
		this.owner.ViewIdeaSignalSelection(selection);
	}

	// Identifies the active Idea as the owner of these Signal associations.
	protected GetAssociationOwner(): "Idea"
	{
		return "Idea";
	}

	// Removes one Signal from the active Idea without affecting other associations.
	protected RemoveSignalAssociation(signalId: string): void
	{
		this.controller.RemoveSignal({ signalId });
	}

	// Deletes one Signal from every Dream and Idea.
	protected DeleteSignalEverywhereAsync(signalId: string): Promise<boolean>
	{
		const deletion = this.signals === null
			? Promise.resolve(false)
			: this.signals.DeleteEverywhereAsync(signalId);

		return deletion;
	}

	// Saves one shared Signal description.
	protected UpdateSignalDescription(signalId: string, description: string): void
	{
		if (this.signals !== null)
		{
			const update = this.signals.UpdateDescriptionAsync(signalId, description);
			void update;
		}
	}

	// Saves one shared Signal title.
	protected UpdateSignalTitle(signalId: string, title: string): void
	{
		void this.signals?.UpdateTitleAsync(signalId, title);
	}

	// Removes one exact passage from the shared Signal.
	protected RemoveSignalSelection(signalId: string, selectionIndex: number): void
	{
		void this.signals?.RemoveSelectionAsync(signalId, selectionIndex);
	}

	// Opens the Idea's work-wide Signal browser.
	protected AddSignal(): void
	{
		this.owner.OpenIdeaSignalBrowser();
	}

}
