import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { SignalController } from "../signals/SignalController.js";
import { SignalViewPanel, type SignalViewRecord } from "../signals/SignalViewPanel.js";
import { IdeaController } from "./IdeaController.js";

// Provides selected-Signal state owned by the Idea editor.
export interface IdeaSignalViewOwner
{
	// Returns the Signal remembered by the active Idea editor.
	GetSelectedIdeaSignal(): string | null;
	// Remembers the selected Signal for the active Idea editor.
	RememberSelectedIdeaSignal(signalId: string | null): void;
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
	public Update(signals: readonly SignalViewRecord[]): void
	{
		this.UpdateSignals(signals);

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

	// Navigates the reader to one Idea Signal.
	protected async ViewSignalAsync(signalId: string): Promise<void>
	{
		await this.controller.ViewSignalAsync({ signalId });
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

	// Saves one shared Signal description.
	protected UpdateSignalDescription(signalId: string, description: string): void
	{
		if (this.signals !== null)
		{
			const update = this.signals.UpdateDescriptionAsync(signalId, description);
			void update;
		}
	}

	// Opens the Idea's work-wide Signal browser.
	protected AddSignal(): void
	{
		this.owner.OpenIdeaSignalBrowser();
	}

}
