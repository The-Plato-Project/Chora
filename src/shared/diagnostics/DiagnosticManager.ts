import { ApplicationError, type OperationFailure } from "./OperationResult.js";
import { DiagnosticSanitizer } from "./DiagnosticSanitizer.js";

export type LogLevel = "debug" | "info" | "warning" | "error";

export interface ErrorRecord
{
	id: string;
	timestamp: string;
	level: LogLevel;
	source: string;
	message: string;
	details?: unknown;
	userMessage?: string;
	// Distinguishes renderer and privileged-process records in the persistent log.
	process?: "main" | "renderer";
	// Carries structured operation and recovery metadata when a command failed.
	failure?: OperationFailure;
}

export type ErrorRecordSink = (record: ErrorRecord) => void;

export class DiagnosticManager
{
	// Recent diagnostics are bounded; durable storage belongs to the main process.
	private readonly records: ErrorRecord[] = [];
	// Correlates repeated catches of the same local exception.
	private readonly failures = new WeakMap<object, ErrorRecord>();

	public constructor(private readonly sink?: ErrorRecordSink)
	{
	}

	public Debug(source: string, message: string, details?: unknown): void
	{
		this.Record("debug", source, message, undefined, details);
	}

	public Info(source: string, message: string, details?: unknown): void
	{
		this.Record("info", source, message, undefined, details);
	}

	public Warning(source: string, message: string, details?: unknown): void
	{
		this.Record("warning", source, message, undefined, details);
	}

	public Error(source: string, message: string, details?: unknown): void
	{
		this.Record("error", source, message, undefined, details);
	}

	// Records technical details once and publishes an explicit user-facing failure separately.
	public Report(source: string, error: unknown, userMessage: string): void
	{
		const failure = error instanceof ApplicationError ? error.failure : undefined;
		if (failure?.kind !== "cancelled")
		{
			const reported = this.Describe(source, error, userMessage);
			this.Publish(reported, false);
		}
	}

	// Supplies the same safe message and diagnostic identity to a feature-owned error surface.
	public Describe(source: string, error: unknown, userMessage: string): ErrorRecord
	{
		const record = this.Capture(source, error);
		const failure = error instanceof ApplicationError ? error.failure : undefined;
		const message = failure === undefined ? userMessage : `${userMessage} ${failure.message}`;
		const reported: ErrorRecord = { ...record, userMessage: DiagnosticSanitizer.Text(message) };

		return reported;
	}

	// Reports a known applied operation whose remaining cleanup needs attention.
	public ReportWarning(source: string, error: unknown, message: string): void
	{
		const failure: OperationFailure = { kind: "io", code: "CLEANUP_PENDING", message, recovery: "inspect-state", outcome: "applied", diagnosticId: "", operation: source };
		const record = this.Capture(source, error, failure);
		this.Publish({ ...record, level: "warning", userMessage: message }, false);
	}

	// Creates or reuses the diagnostic reference for a failure caught by multiple owners.
	public Capture(source: string, error: unknown, classification?: OperationFailure, context?: string): ErrorRecord
	{
		const failure = classification ?? (error instanceof ApplicationError ? error.failure : undefined);
		const previous = typeof error === "object" && error !== null ? this.failures.get(error) : undefined;
		let record: ErrorRecord;
		if (previous !== undefined) record = previous;
		else
		{
			const message = context ?? (error instanceof Error ? error.message : String(error));
			const id = failure?.diagnosticId || crypto.randomUUID();
			record = { id, timestamp: new Date().toISOString(), level: failure?.kind === "cancelled" ? "info" : failure?.outcome === "applied" || failure?.kind === "validation" || failure?.kind === "conflict" || failure?.kind === "not-found" ? "warning" : "error", source, message: DiagnosticSanitizer.Text(message), details: DiagnosticSanitizer.Details(error) };
			record.failure = failure === undefined
				? { code: "UNEXPECTED_FAILURE", kind: "unexpected", message: "The operation could not finish.", recovery: "inspect-state", outcome: "unknown", diagnosticId: id, operation: source }
				: { ...failure, diagnosticId: id, operation: failure.operation || source };
			if (typeof error === "object" && error !== null) this.failures.set(error, record);
			// Main-process IPC failures already have durable diagnostics under this identity.
			if (!failure?.diagnosticId) this.Publish(record, true);
		}

		return structuredClone(record);
	}

	// Accepts a validated cross-process record while preserving its correlation identity.
	public Accept(record: ErrorRecord): void
	{
		this.Publish(structuredClone(record), true);
	}

	// Allows a process owner to redact configured credentials before any diagnostic sink observes them.
	protected PrepareRecord(record: ErrorRecord): ErrorRecord
	{
		return record;
	}

	// Allows the process-specific owner to attach storage and presentation sinks.
	protected OnRecord(record: ErrorRecord, persist: boolean): void
	{
		if (persist) this.sink?.(record);
	}


	public GetRecords(): readonly ErrorRecord[]
	{
		const records = structuredClone(this.records);

		return records;
	}

	private Record(level: LogLevel, source: string, message: string, userMessage?: string, details?: unknown): void
	{
		if (level === "error" && details instanceof Error)
		{
			this.Capture(source, details, undefined, message);
		}
		else
		{
			const record: ErrorRecord = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, source, message: DiagnosticSanitizer.Text(message) };
			if (userMessage !== undefined) record.userMessage = DiagnosticSanitizer.Text(userMessage);
			if (details !== undefined) record.details = DiagnosticSanitizer.Details(details);
			this.Publish(record, true);
		}
	}

	// Bounds memory, preserves record identity, and isolates failures in logging infrastructure.
	private Publish(record: ErrorRecord, persist: boolean): void
	{
		record = this.PrepareRecord(record);
		const index = this.records.findIndex(function Matches(item): boolean { return item.id === record.id; });
		if (index < 0) this.records.push(structuredClone(record));
		else this.records[index] = structuredClone(record);
		if (this.records.length > 500) this.records.splice(0, this.records.length - 500);
		if (persist) this.WriteConsole(record);
		try
		{
			this.OnRecord(record, persist);
		}
		catch
		{
			console.error("[Chora][Diagnostics] A diagnostic sink failed.");
		}
	}

	private WriteConsole(record: ErrorRecord): void
	{
		const prefix = `[Chora][${record.level.toUpperCase()}][${record.source}]`;
		if (record.level === "error") console.error(prefix, record.message, record.details ?? "");
		if (record.level === "warning") console.warn(prefix, record.message, record.details ?? "");
		if (record.level === "info") console.info(prefix, record.message, record.details ?? "");
		if (record.level === "debug") console.debug(prefix, record.message, record.details ?? "");
	}
}
