import { DiagnosticManager, type ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
import type { ChoraEvents } from "../events/ChoraEvents.js";
import { ChoraEventBus } from "../events/ChoraEventBus.js";

// Owns renderer persistence forwarding and user-facing diagnostic publication.
export class ErrorManager extends DiagnosticManager
{
	// Avoids logging failures recursively when the logging bridge is unavailable.
	private bridgeFailureReported = false;
	// Prevents repeated catches from displaying the same failure more than once.
	private readonly reported = new Set<string>();

	// Shares one typed event bus with the feature controllers and application presentation.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>)
	{
		super();
	}

	// Receives an already persisted main-process notification without writing it again.
	public Receive(record: ErrorRecord): void
	{
		this.PublishNotification(record);
	}

	// Sends serializable renderer records to main and separates persistence from presentation.
	protected override OnRecord(record: ErrorRecord, persist: boolean): void
	{
		if (persist && typeof window.chora?.RecordDiagnostic === "function") void this.StoreAsync(record);
		this.PublishNotification(record);
	}

	// Shows only explicit user-facing failures and preserves their diagnostic references.
	private PublishNotification(record: ErrorRecord): void
	{
		if (record.userMessage !== undefined && !this.reported.has(record.id))
		{
			this.reported.add(record.id);
			if (this.reported.size > 500)
			{
				const first = this.reported.values().next().value;
				if (first !== undefined) this.reported.delete(first);
			}
			void this.events.PublishAsync("error.reported", record);
		}
	}

	// Keeps logging transport failures from replacing the operation failure or triggering report loops.
	private async StoreAsync(record: ErrorRecord): Promise<void>
	{
		try
		{
			const response = await window.chora.RecordDiagnostic({ ...record, process: "renderer" });
			if (!response.ok) throw new Error("Diagnostic storage rejected the record.");
		}
		catch
		{
			if (!this.bridgeFailureReported)
			{
				this.bridgeFailureReported = true;
				console.error("[Chora][Diagnostics] Renderer diagnostics could not be persisted; recent records remain in memory.");
			}
		}
	}
}
