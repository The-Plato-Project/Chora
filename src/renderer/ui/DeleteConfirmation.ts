import { EscapeHtml } from "./Html.js";
import { PopupPanel } from "./PopupPanel.js";

// Owns one deliberate confirmation workflow for deleting a named library item.
export class DeleteConfirmation
{
	// Popup reused across confirmation requests.
	private popup: PopupPanel | null = null;
	// Current deletion action invoked only after explicit confirmation.
	private deleteAction: (() => Promise<boolean>) | null = null;
	// Element that regains focus after the confirmation closes.
	private trigger: HTMLElement | null = null;

	// Opens a cancellation-first confirmation for one named item.
	public Open(
		subject: string,
		title: string,
		message: string,
		trigger: HTMLElement | null,
		deleteAction: () => Promise<boolean>): void
	{
		const name = title.trim() || "Untitled";
		const popup = this.GetPopup();
		this.trigger = trigger;
		this.deleteAction = deleteAction;
		popup.SetTitle(`Delete ${subject}?`);
		popup.SetBodyHtml(`<p>Delete <strong>${EscapeHtml(name)}</strong>?</p><p>${EscapeHtml(message)}</p><p data-delete-error role="alert" hidden>Unable to delete this ${EscapeHtml(subject.toLocaleLowerCase())}. It remains in your library.</p><div class="popup-actions"><button class="button-control" data-delete-cancel type="button">Cancel</button><button class="button-control" data-delete-confirm type="button">Delete ${EscapeHtml(subject)}</button></div>`);
		popup.Open();
		const cancel = document.querySelector<HTMLButtonElement>(".popup-overlay:not([hidden]) [data-delete-cancel]");
		cancel?.focus();
	}

	// Releases the owned popup.
	public Dispose(): void
	{
		this.popup?.Dispose();
		this.popup = null;
	}

	// Routes cancellation and confirmed deletion from the popup.
	private async HandleClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const cancel = target?.closest("[data-delete-cancel]") ?? null;
		const confirm = target?.closest<HTMLButtonElement>("[data-delete-confirm]") ?? null;

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
				const error = document.querySelector<HTMLElement>(".popup-overlay:not([hidden]) [data-delete-error]");
				if (error !== null) error.hidden = false;
				confirm.focus();
			}
		}
	}

	// Creates the reusable popup when it is first needed.
	private GetPopup(): PopupPanel
	{
		if (this.popup === null)
		{
			this.popup = new PopupPanel("Delete?");
			this.popup.OnBodyClick(this.HandleClickAsync.bind(this));
			this.popup.OnClose(this.HandleClosed.bind(this));
		}

		return this.popup;
	}

	// Restores focus and clears the completed confirmation request.
	private HandleClosed(): void
	{
		const fallback = document.querySelector<HTMLElement>("[data-workspace-tab]");
		const focusTarget = this.trigger?.isConnected === true ? this.trigger : fallback;
		this.deleteAction = null;
		this.trigger = null;
		focusTarget?.focus({ preventScroll: true });
	}
}
