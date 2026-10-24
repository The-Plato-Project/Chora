import { EscapeHtml } from "../ui/Html.js";
import { PopupPanel } from "../ui/PopupPanel.js";

// Identifies the document association removed from a Signal.
export type SignalAssociationOwner = "Dream" | "Idea";

// Owns the safe confirmation workflow for removing a Signal association.
export class SignalRemovalConfirmation
{
	private popup: PopupPanel | null = null;
	private removeAction: (() => void) | null = null;
	private deleteEverywhereAction: (() => Promise<boolean>) | null = null;
	private trigger: HTMLElement | null = null;

	// Opens a removal confirmation focused on the safe cancellation action.
	public Open(
		signalText: string,
		owner: SignalAssociationOwner,
		trigger: HTMLElement,
		removeAction: () => void,
		deleteEverywhereAction: () => Promise<boolean>): void
	{
		const name = signalText.trim() || "Untitled Signal";
		const popup = this.GetPopup();
		this.trigger = trigger;
		this.removeAction = removeAction;
		this.deleteEverywhereAction = deleteEverywhereAction;
		popup.SetBodyHtml(`<p>Remove <strong>${EscapeHtml(name)}</strong> from this ${owner}?</p><p><strong>Remove from this ${owner}</strong> keeps the Signal everywhere else it is connected.</p><p><strong>Delete Signal Everywhere</strong> removes it from every Dream and Idea and permanently deletes the Signal.</p><p data-signal-delete-error role="alert" hidden>Unable to delete this Signal everywhere. Nothing else will be deleted.</p><div class="popup-actions"><button class="button-control" data-signal-remove-cancel type="button">Cancel</button><button class="button-control" data-signal-remove-confirm type="button">Remove from this ${owner}</button><button class="button-control" data-signal-delete-everywhere type="button">Delete Signal Everywhere</button></div>`);
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
	private async HandleClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const cancel = target?.closest("[data-signal-remove-cancel]") ?? null;
		const confirm = target?.closest("[data-signal-remove-confirm]") ?? null;
		const deleteEverywhere = target?.closest<HTMLButtonElement>("[data-signal-delete-everywhere]") ?? null;

		if (cancel !== null)
		{
			this.popup?.Close();
		}
		else if (confirm !== null && this.removeAction !== null)
		{
			this.removeAction();
			this.popup?.Close();
		}
		else if (deleteEverywhere !== null && this.deleteEverywhereAction !== null)
		{
			deleteEverywhere.disabled = true;
			const deleted = await this.deleteEverywhereAction();

			if (deleted)
			{
				this.popup?.Close();
			}
			else
			{
				deleteEverywhere.disabled = false;
				const error = document.querySelector<HTMLElement>('.popup-overlay:not([hidden]) [data-signal-delete-error]');
				if (error !== null) error.hidden = false;
				deleteEverywhere.focus();
			}
		}
	}

	// Creates the popup only when removal is requested.
	private GetPopup(): PopupPanel
	{
		if (this.popup === null)
		{
			this.popup = new PopupPanel("Remove Signal?");
			this.popup.OnBodyClick(this.HandleClickAsync.bind(this));
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
		this.deleteEverywhereAction = null;
		this.trigger = null;
		focusTarget?.focus({ preventScroll: true });
	}
}
