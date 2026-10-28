import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import { EscapeHtml } from "../ui/Html.js";
import { PopupPanel } from "../ui/PopupPanel.js";
import type { DreamTrashController } from "./DreamTrashController.js";

// Owns the trash dialog, explicit destructive confirmation, and local interaction state.
export class DreamTrashPanel
{
	// Lazily created persistent popup.
	private popup: PopupPanel | null = null;
	// Current renderer-safe list used only for display and confirmation.
	private records: readonly DreamTrashSnapshot[] = [];
	// Confirmed action awaiting a deliberate second click.
	private pending: { action: "purge" | "empty"; id: string } | null = null;
	// Prevents double submission and competing actions during filesystem operations.
	private busy = false;
	// Restores keyboard focus when Trash closes.
	private trigger: HTMLElement | null = null;

	// Creates the DOM boundary around its dedicated workflow controller.
	public constructor(private readonly controller: DreamTrashController)
	{
	}

	// Opens Trash and loads its current contents.
	public async OpenAsync(trigger: HTMLElement): Promise<void>
	{
		if (this.popup === null)
		{
			this.popup = new PopupPanel("Trash");
			this.popup.OnBodyClick(this.HandleClickAsync.bind(this));
			this.popup.OnClose(this.HandleClose.bind(this));
		}
		this.trigger = trigger;
		this.popup.Open();
		if (!this.busy)
		{
			this.pending = null;
			await this.RefreshAsync();
		}
	}

	// Releases the owned popup.
	public Dispose(): void
	{
		this.popup?.Dispose();
	}

	// Refreshes records and keeps load errors within the dialog.
	private async RefreshAsync(): Promise<void>
	{
		this.busy = true;
		this.popup?.SetBodyHtml('<p role="status">Loading Trash…</p>');
		try
		{
			this.records = await this.controller.ListAsync();
			this.Render();
			this.Focus("restore");
		}
		catch (error)
		{
			const reference = error instanceof ApplicationError ? error.failure.diagnosticId : "";
			this.popup?.SetBodyHtml(`<p role="alert">Unable to load Trash. Close and reopen it to retry.</p><p>Diagnostic reference: ${EscapeHtml(reference)}</p>`);
		}
		finally
		{
			this.busy = false;
		}
	}

	// Renders retained Dreams, deletion dates, and explicit action labels.
	private Render(): void
	{
		let content = '<p>Deleted Dreams and their Signals stay here until you restore or permanently delete them. Nothing expires automatically.</p>';
		if (this.records.length === 0) content += '<p>Trash is empty.</p>';
		for (const record of this.records)
		{
			const name = EscapeHtml(record.title || "Untitled Dream");
			const date = new Date(record.deletedAt).toLocaleString();
			content += `<section class="dream-trash-item"><strong>${name}</strong><p>${EscapeHtml(record.workId)} · Deleted ${EscapeHtml(date)} · ${record.signalCount} Signals</p>${record.restoring ? '<p>Restore was interrupted. Retry Restore to finish.</p>' : ''}<div class="popup-actions"><button class="button-control" data-trash-action="restore" data-trash-id="${record.id}" type="button">Restore</button><button class="button-control" data-trash-action="purge" data-trash-id="${record.id}" type="button"${record.restoring ? " disabled" : ""}>Delete permanently</button></div></section>`;
		}
		if (this.records.length > 0) content += '<div class="popup-actions"><button class="button-control" data-trash-action="empty" type="button">Empty trash</button></div>';
		this.popup?.SetBodyHtml(content);
	}

	// Routes cancellation, deliberate confirmation, and restoring retained items.
	private async HandleClickAsync(event: MouseEvent): Promise<void>
	{
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>("[data-trash-action]");
		if (button !== null && button !== undefined && !this.busy)
		{
			const action = button.dataset.trashAction;
			const id = button.dataset.trashId ?? "";
			if (action === "cancel")
			{
				this.pending = null;
				this.Render();
			}
			else if (action === "purge" || action === "empty")
			{
				this.pending = { action, id };
				const record = this.records.find(function Match(candidate): boolean { return candidate.id === id; });
				const subject = action === "empty" ? "all Dreams in Trash" : EscapeHtml(record?.title || "Untitled Dream");
				this.popup?.SetBodyHtml(`<p>Permanently delete <strong>${subject}</strong> and their Signals? This cannot be undone.</p><div class="popup-actions"><button class="button-control" data-trash-action="cancel" type="button">Cancel</button><button class="button-control" data-trash-action="confirm" type="button">${action === "empty" ? "Empty trash permanently" : "Delete permanently"}</button></div>`);
				this.Focus("cancel");
			}
			else if (action === "restore" || (action === "confirm" && this.pending !== null))
			{
				const operation = action === "restore" ? { action: "restore" as const, id } : this.pending!;
				this.busy = true;
				this.popup?.SetBodyHtml('<p role="status">Updating Trash…</p>');
				const completed = await this.controller.ExecuteAsync(operation.action, operation.id);
				this.pending = null;
				await this.RefreshAsync();
				if (!completed) this.popup?.SetBodyHtml('<p role="alert">The operation could not finish. Close and reopen Trash to retry. Interrupted restores also resume when Chora starts.</p>');
			}
		}
	}

	// Focuses a visible dialog action without relying on DOM insertion order.
	private Focus(action: string): void
	{
		const button = document.querySelector<HTMLElement>(`.popup-overlay:not([hidden]) [data-trash-action="${action}"]`);
		button?.focus();
	}

	// Restores focus to the current Explorer Trash button after rerenders.
	private HandleClose(): void
	{
		const fallback = document.querySelector<HTMLElement>("[data-open-dream-trash]");
		const target = this.trigger?.isConnected === true ? this.trigger : fallback;
		target?.focus();
	}
}
