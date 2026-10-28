import type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
import type { ChoraEvents } from "../events/ChoraEvents.js";
import type { ChoraEventBus, Unsubscribe } from "../events/ChoraEventBus.js";
import { EscapeHtml } from "../../ui/Html.js";
import { PopupPanel } from "../../ui/PopupPanel.js";

// Owns diagnostic notification ordering, popup lifetime, and dismissal without coordinating feature operations.
export class ErrorNotificationPanel
{
	// Subscription released with this UI owner.
	private readonly unsubscribe: Unsubscribe;
	// Prevents disposed presentation from reopening a queued popup.
	private isDisposed = false;
	private errorPopup: PopupPanel | null = null;
	// User notifications waiting for explicit dismissal of the current message.
	private readonly pendingErrors: ErrorRecord[] = [];
	// Suppresses duplicate notifications from repeated catches of the same operation failure.
	private readonly seenErrorIds = new Set<string>();

	// Subscribes only to completed user-facing diagnostic reports.
	public constructor(events: ChoraEventBus<ChoraEvents>)
	{
		this.unsubscribe = events.Subscribe("error.reported", this.HandleErrorReported.bind(this));
	}

	// Releases notification state and its DOM roots.
	public Dispose(): void
	{
		this.isDisposed = true;
		this.unsubscribe();
		this.pendingErrors.length = 0;
		this.CloseErrorPopup();
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
		if (this.errorPopup === null && !this.isDisposed)
		{
			const error = this.pendingErrors.shift();
			if (error !== undefined)
			{
				this.errorPopup = new PopupPanel(error.level === "warning" ? "Operation needs attention" : "Operation could not finish");
				const message = error.userMessage ?? error.message;
				this.errorPopup.SetBodyHtml(`<p role="alert">${EscapeHtml(message)}</p><p>Diagnostic reference: ${EscapeHtml(error.id)}</p><p>Logs are available from Help → Open Logs Folder.</p>`);
				this.errorPopup.OnClose(this.CloseErrorPopup.bind(this));
				this.errorPopup.Open();
			}
		}
	}

	// Releases the dismissed notification before presenting any queued failure.
	private CloseErrorPopup(): void
	{
		const popup = this.errorPopup;
		this.errorPopup = null;
		popup?.Dispose();
		this.ShowNextError();
	}

}
