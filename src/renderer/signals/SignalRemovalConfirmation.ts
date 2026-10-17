import { EscapeHtml } from "../ui/Html.js";
import { PopupPanel } from "../ui/PopupPanel.js";

// Identifies the document association removed from a Signal.
export type SignalAssociationOwner = "Dream" | "Idea";

// Owns the safe confirmation workflow for removing a Signal association.
export class SignalRemovalConfirmation
{
	private popup: PopupPanel | null = null;
	private removeAction: (() => void) | null = null;
	private trigger: HTMLElement | null = null;

	// Opens a removal confirmation focused on the safe cancellation action.
	public Open(
		signalText: string,
		owner: SignalAssociationOwner,
		trigger: HTMLElement,
		removeAction: () => void): void
	{
		const name = signalText.trim() || "Untitled Signal";
		const popup = this.GetPopup();
		this.trigger = trigger;
		this.removeAction = removeAction;
		popup.SetBodyHtml(`<p>Remove <strong>${EscapeHtml(name)}</strong> from this ${owner}?</p><p>This removes only this connection. The Signal remains available anywhere else it is connected.</p><div class="popup-actions"><button class="button-control" data-signal-remove-cancel type="button">Cancel</button><button class="button-control" data-signal-remove-confirm type="button">Remove Signal</button></div>`);
		popup.Open();
		const cancel = document.querySelector<HTMLButtonElement>('.popup-overlay:not([hidden]) [data-signal-remove-cancel]');
		cancel?.focus();
	}

	// Releases the lazily created popup.
	public Dispose(): void
	{
		this.popup?.Dispose();
		this.popup = null;
	}

	// Applies the reader's cancellation or explicit removal choice.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const cancel = target?.closest("[data-signal-remove-cancel]") ?? null;
		const confirm = target?.closest("[data-signal-remove-confirm]") ?? null;

		if (cancel !== null)
		{
			this.popup?.Close();
		}
		else if (confirm !== null && this.removeAction !== null)
		{
			this.removeAction();
			this.popup?.Close();
		}
	}

	// Creates the popup only when removal is requested.
	private GetPopup(): PopupPanel
	{
		if (this.popup === null)
		{
			this.popup = new PopupPanel("Remove Signal?");
			this.popup.OnBodyClick(this.HandleClick.bind(this));
			this.popup.OnClose(this.HandleClosed.bind(this));
		}

		return this.popup;
	}

	// Clears transient actions and restores focus after the prompt closes.
	private HandleClosed(): void
	{
		const fallback = document.querySelector<HTMLElement>("[data-signal-toggle]");
		const focusTarget = this.trigger?.isConnected === true ? this.trigger : fallback;
		this.removeAction = null;
		this.trigger = null;
		focusTarget?.focus({ preventScroll: true });
	}
}
