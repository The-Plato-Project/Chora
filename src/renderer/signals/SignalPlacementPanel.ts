import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { EscapeHtml } from "../ui/Html.js";
import { DocumentIcon, IdeaIcon } from "../ui/Icons.js";
import { PopupPanel } from "../ui/PopupPanel.js";
import { SignalPlacementController, type SignalDestination } from "./SignalPlacementController.js";

// Owns transient destination choices for Signals selected in the reading text.
export class SignalPlacementPanel
{
	private readonly subscription: Unsubscribe;
	private popup: PopupPanel | null = null;
	private selection: TextSelection | null = null;
	private destinations: readonly SignalDestination[] = [];

	public constructor(
		events: ChoraEventBus<ChoraEvents>,
		private readonly controller: SignalPlacementController)
	{
		this.subscription = events.Subscribe("signal.add-requested", this.HandleAddRequestedAsync.bind(this));
	}

	public Dispose(): void
	{
		this.subscription();
		this.ClosePopup();
	}

	private async HandleAddRequestedAsync(event: ChoraEvents["signal.add-requested"]): Promise<void>
	{
		const destinations = this.controller.GetDestinations(event.selection);

		if (destinations.length === 1)
		{
			const destination = destinations[0];
			if (destination !== undefined) await this.controller.PlaceAsync(event.selection, destination);
		}
		else
		{
			this.selection = structuredClone(event.selection);
			this.destinations = destinations;
			this.ShowPopup();
		}
	}

	private ShowPopup(): void
	{
		this.ClosePopup();
		const hasDestinations = this.destinations.length > 0;
		this.popup = new PopupPanel(hasDestinations ? "Choose where to add this Signal" : "Create a Dream or Idea");
		let markup = "";

		if (hasDestinations)
		{
			let rows = "";
			for (const destination of this.destinations)
			{
				const icon = destination.kind === "dream" ? DocumentIcon : IdeaIcon;
				const kind = destination.kind === "dream" ? "Dream" : "Idea";
				rows += `<button class="signal-destination-choice button-control" data-signal-destination-kind="${destination.kind}" data-signal-destination-id="${EscapeHtml(destination.id)}" type="button"><span aria-hidden="true">${icon}</span><span><strong>${EscapeHtml(destination.title)}</strong><small>${kind}</small></span></button>`;
			}
			markup = `<p>This passage belongs to more than one document. Choose where to add and edit the Signal.</p><div class="signal-destination-list">${rows}</div>`;
		}
		else
		{
			markup = `<p>This passage does not belong to an existing Dream or Idea. Create one to add and edit the Signal.</p><div class="signal-destination-actions"><button class="button-control" data-create-signal-dream type="button">${DocumentIcon}<span>Create Dream</span></button><button class="button-control" data-create-signal-idea type="button">${IdeaIcon}<span>Create Idea</span></button></div>`;
		}

		this.popup.SetBodyHtml(markup);
		this.popup.OnBodyClick(this.HandlePopupClickAsync.bind(this));
		this.popup.OnClose(this.HandlePopupClosed.bind(this));
		this.popup.Open();
	}

	private async HandlePopupClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const choice = target?.closest<HTMLElement>("[data-signal-destination-id]");
		const createsDream = target?.closest("[data-create-signal-dream]") !== null;
		const createsIdea = target?.closest("[data-create-signal-idea]") !== null;
		const selection = this.selection;

		if (selection !== null && choice !== null && choice !== undefined)
		{
			const destination = this.destinations.find(function FindDestination(candidate): boolean
			{
				return candidate.kind === choice.dataset.signalDestinationKind
					&& candidate.id === choice.dataset.signalDestinationId;
			});
			this.ClosePopup();
			if (destination !== undefined) await this.controller.PlaceAsync(selection, destination);
		}
		else if (selection !== null && createsDream)
		{
			this.ClosePopup();
			await this.controller.CreateDreamAsync(selection);
		}
		else if (selection !== null && createsIdea)
		{
			this.ClosePopup();
			await this.controller.CreateIdeaAsync(selection);
		}
	}

	private HandlePopupClosed(): void
	{
		this.selection = null;
		this.destinations = [];
	}

	private ClosePopup(): void
	{
		const popup = this.popup;
		this.popup = null;

		if (popup !== null)
		{
			popup.Close();
			popup.Dispose();
		}
	}
}
