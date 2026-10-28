import { EscapeHtml } from "../ui/Html.js";
import { PopupPanel } from "../ui/PopupPanel.js";

// Owns the confirmation workflow for deleting one Dream-owned Signal.
export class SignalRemovalConfirmation
{
	// Lazily created confirmation popup.
	private popup: PopupPanel | null = null;
	// Canonical deletion action supplied by the Signal controller.
	private deleteAction: (() => Promise<boolean>) | null = null;
	// Control that opened the prompt.
	private trigger: HTMLElement | null = null;

	// Opens the single unambiguous Signal deletion confirmation.
	public Open(signalText: string, trigger: HTMLElement, deleteAction: () => Promise<boolean>): void
	{
		const name = signalText.trim() || "Untitled Signal";
		const popup = this.GetPopup();
		this.trigger = trigger;
		this.deleteAction = deleteAction;
		popup.SetBodyHtml(`<p>Delete <strong>${EscapeHtml(name)}</strong>?</p><p>This permanently deletes the Signal from its Dream.</p><p data-signal-delete-error role="alert" hidden>Unable to delete this Signal. Nothing was changed.</p><div class="popup-actions"><button class="button-control" data-signal-delete-cancel type="button">Cancel</button><button class="button-control danger" data-signal-delete-confirm type="button">Delete Signal</button></div>`);
		popup.Open();
		const cancel = document.querySelector<HTMLButtonElement>('.popup-overlay:not([hidden]) [data-signal-delete-cancel]');
		cancel?.focus();
	}

	// Releases the lazily created popup.
	public Dispose(): void
	{
		this.popup?.Dispose();
		this.popup = null;
	}

	// Applies cancellation or the one canonical deletion action.
	private async HandleClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const cancel = target?.closest("[data-signal-delete-cancel]") ?? null;
		const confirm = target?.closest<HTMLButtonElement>("[data-signal-delete-confirm]") ?? null;

		if (cancel !== null)
		{
			this.popup?.Close();
		}
		else if (confirm !== null && this.deleteAction !== null)
		{
			confirm.disabled = true;
			const deleted = await this.deleteAction();

			if (deleted)
			{
				this.popup?.Close();
			}
			else
			{
				confirm.disabled = false;
				const error = document.querySelector<HTMLElement>('.popup-overlay:not([hidden]) [data-signal-delete-error]');
				if (error !== null) error.hidden = false;
				confirm.focus();
			}
		}
	}

	// Creates the popup only when deletion is requested.
	private GetPopup(): PopupPanel
	{
		if (this.popup === null)
		{
			this.popup = new PopupPanel("Delete Signal?");
			this.popup.OnBodyClick(this.HandleClickAsync.bind(this));
			this.popup.OnClose(this.HandleClosed.bind(this));
		}

		return this.popup;
	}

	// Clears transient actions and restores focus without scrolling.
	private HandleClosed(): void
	{
		const fallback = document.querySelector<HTMLElement>("[data-signal-toggle]");
		const focusTarget = this.trigger?.isConnected === true ? this.trigger : fallback;
		this.deleteAction = null;
		this.trigger = null;
		focusTarget?.focus({ preventScroll: true });
	}
}
