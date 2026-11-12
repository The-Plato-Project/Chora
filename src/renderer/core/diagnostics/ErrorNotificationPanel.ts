import type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
import type { ChoraEvents } from "../events/ChoraEvents.js";
import type { ChoraEventBus, Unsubscribe } from "../events/ChoraEventBus.js";
import { EscapeHtml } from "../../ui/Html.js";
import { DialogControl } from "../../ui/controls/DialogControl.js";
import { ErrorManager } from "./RendererErrorManager.js";

// Owns diagnostic notification ordering, dialog lifetime, and dismissal without coordinating feature operations.
export class ErrorNotificationPanel
{
	// Subscription released with this UI owner.
	private readonly unsubscribe: Unsubscribe;
	// Prevents disposed presentation from reopening a queued dialog.
	private isDisposed = false;
	private errorDialog: DialogControl | null = null;
	// Uses the shared diagnostic authority for unexpected presentation failures.
	private readonly errors: ErrorManager;
	// User notifications waiting for explicit dismissal of the current message.
	private readonly pendingErrors: ErrorRecord[] = [];
	// Suppresses duplicate notifications from repeated catches of the same operation failure.
	private readonly seenErrorIds = new Set<string>();

	// Subscribes only to completed user-facing diagnostic reports.
	public constructor(events: ChoraEventBus<ChoraEvents>)
	{
		this.errors = new ErrorManager(events);
		this.unsubscribe = events.Subscribe("error.reported", this.HandleErrorReported.bind(this));
	}

	// Releases notification state and its DOM roots.
	public Dispose(): void
	{
		this.isDisposed = true;
		this.unsubscribe();
		this.pendingErrors.length = 0;
		this.CloseErrorDialog();
	}

	// Queues each diagnostic identity once for presentation.
	private HandleErrorReported(error: ErrorRecord): void
	{
		if (!this.seenErrorIds.has(error.id))
		{
			this.seenErrorIds.add(error.id);
			if (this.seenErrorIds.size > 500)
			{
				const first = this.seenErrorIds.values().next().value;
				if (first !== undefined) this.seenErrorIds.delete(first);
			}
			if (this.pendingErrors.length >= 100) this.pendingErrors.shift();
			this.pendingErrors.push(error);
			this.ShowNextError();
		}
	}


	// Presents the next queued notification with a reference that can be found in the log.
	private ShowNextError(): void
	{
		if (this.errorDialog === null && !this.isDisposed)
		{
			const error = this.pendingErrors.shift();
			if (error !== undefined)
			{
				this.errorDialog = new DialogControl(this.errors);
				const message = error.userMessage ?? error.message;
				this.errorDialog.Open({
					Title: error.level === "warning" ? "Operation needs attention" : "Operation could not finish",
					Content: `<p role="alert">${EscapeHtml(message)}</p><p>Diagnostic reference: ${EscapeHtml(error.id)}</p><p>Logs are available from Help → Open Logs Folder.</p>`,
					Closed: this.CloseErrorDialog.bind(this)
				});
			}
		}
	}

	// Releases the dismissed notification before presenting any queued failure.
	private CloseErrorDialog(): void
	{
		const popup = this.errorDialog;
		this.errorDialog = null;
		popup?.Dispose();
		this.ShowNextError();
	}

}
