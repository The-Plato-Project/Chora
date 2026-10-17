import { EscapeHtml } from "./Html.js";
import { PopupPanel } from "./PopupPanel.js";

// Identifies the reader-owned document protected by a delete confirmation.
export type DeleteDocumentKind = "Dream" | "Idea";

// Owns the deliberate confirmation workflow shared by document deletion menus.
export class DeleteConfirmation
{
	private popup: PopupPanel | null = null;
	private deleteAction: (() => Promise<boolean>) | null = null;
	private trigger: HTMLElement | null = null;
	private kind: DeleteDocumentKind = "Dream";

	// Opens a confirmation that defaults keyboard focus to the safe action.
	public Open(
		kind: DeleteDocumentKind,
		title: string,
		message: string,
		trigger: HTMLElement | null,
		deleteAction: () => Promise<boolean>): void
	{
		const name = title.trim() || "Untitled";
		const kindKey = kind.toLowerCase();
		const popup = this.GetPopup();
		this.kind = kind;
		this.trigger = trigger;
		this.deleteAction = deleteAction;
		popup.SetTitle(`Delete ${kind}?`);
		popup.SetBodyHtml(`<p>Delete <strong>${EscapeHtml(name)}</strong>?</p><p>${EscapeHtml(message)}</p><p data-${kindKey}-delete-error role="alert" hidden>Unable to delete this ${kind}. It remains in your library.</p><div class="popup-actions"><button class="button-control" data-${kindKey}-delete-cancel type="button">Cancel</button><button class="button-control" data-${kindKey}-delete-confirm type="button">Delete ${kind}</button></div>`);
		popup.Open();
		const cancel = document.querySelector<HTMLButtonElement>(`.popup-overlay:not([hidden]) [data-${kindKey}-delete-cancel]`);
		cancel?.focus();
	}

	// Releases the lazily created popup.
	public Dispose(): void
	{
		this.popup?.Dispose();
		this.popup = null;
	}

	// Applies the safe cancellation or explicit deletion selected by the reader.
	private async HandleClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const kindKey = this.kind.toLowerCase();
		const cancel = target?.closest(`[data-${kindKey}-delete-cancel]`) ?? null;
		const confirm = target?.closest<HTMLButtonElement>(`[data-${kindKey}-delete-confirm]`) ?? null;

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
				const error = document.querySelector<HTMLElement>(`.popup-overlay:not([hidden]) [data-${kindKey}-delete-error]`);
				if (error !== null) error.hidden = false;
				confirm.focus();
			}
		}
	}

	// Creates the popup only when a destructive action is requested.
	private GetPopup(): PopupPanel
	{
		if (this.popup === null)
		{
			this.popup = new PopupPanel("Delete document?");
			this.popup.OnBodyClick(this.HandleClickAsync.bind(this));
			this.popup.OnClose(this.HandleClosed.bind(this));
		}

		return this.popup;
	}

	// Clears transient actions and restores focus after the prompt closes.
	private HandleClosed(): void
	{
		const kindKey = this.kind.toLowerCase();
		const fallback = document.querySelector<HTMLElement>(`[data-workspace-tab-kind="${kindKey}"]`);
		const focusTarget = this.trigger?.isConnected === true ? this.trigger : fallback;
		this.deleteAction = null;
		this.trigger = null;
		focusTarget?.focus({ preventScroll: true });
	}
}
