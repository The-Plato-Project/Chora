import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { DiagnosticSanitizer } from "../../shared/diagnostics/DiagnosticSanitizer.js";
import type { ErrorRecord } from "../../shared/diagnostics/DiagnosticManager.js";
import { IsOperationFailure, ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { ChoraWindowManager } from "../bootstrap/WindowManager.js";
import { Errors } from "./MainErrorManager.js";
import { IpcErrorBoundary } from "./IpcErrorBoundary.js";

// Owns the sole renderer-to-disk diagnostic boundary.
export class DiagnosticIpcController
{
	// Bounds writes from the renderer within one short reporting interval.
	private acceptedRecords = 0;
	// Start of the current diagnostic-ingestion interval.
	private intervalStarted = Date.now();
	// Uses the composed native window as the sender authority.
	public constructor(private readonly windows: ChoraWindowManager)
	{
	}

	// Registers the bounded diagnostic ingestion command.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.recordDiagnostic, this.Record.bind(this));
	}

	// Removes ingestion before the application window is torn down.
	public Unregister(): void
	{
		ipcMain.removeHandler(IPC_CHANNELS.recordDiagnostic);
	}

	// Validates origin, structure, and volume before sanitizing renderer-supplied diagnostics.
	private Record(event: IpcMainInvokeEvent, value: unknown): void
	{
		const owner = this.windows.GetWindow()?.webContents;
		if (owner === undefined || event.sender !== owner || event.senderFrame !== owner.mainFrame)
		{
			throw ApplicationError.Expected("validation", "UNTRUSTED_DIAGNOSTIC", "Untrusted diagnostic request.");
		}
		if (value === null || typeof value !== "object") throw ApplicationError.Expected("validation", "INVALID_DIAGNOSTIC", "Invalid diagnostic record.");
		const now = Date.now();
		if (now - this.intervalStarted > 10000)
		{
			this.intervalStarted = now;
			this.acceptedRecords = 0;
		}
		this.acceptedRecords += 1;
		if (this.acceptedRecords > 200) throw ApplicationError.Expected("conflict", "DIAGNOSTIC_RATE_LIMIT", "Diagnostic ingestion is temporarily limited.");
		const record = value as Record<string, unknown>;
		if (typeof record.id !== "string" || !/^[a-f0-9-]{36}$/u.test(record.id) || typeof record.timestamp !== "string" || !Number.isFinite(Date.parse(record.timestamp)) || typeof record.source !== "string" || record.source.length > 160 || typeof record.message !== "string" || record.message.length > 16000 || !["debug", "info", "warning", "error"].includes(String(record.level)))
		{
			throw ApplicationError.Expected("validation", "INVALID_DIAGNOSTIC", "Invalid diagnostic record fields.");
		}
		if (JSON.stringify(record).length > 65536) throw ApplicationError.Expected("validation", "DIAGNOSTIC_TOO_LARGE", "The diagnostic record is too large.");
		const safe: ErrorRecord = { id: record.id, timestamp: record.timestamp, source: record.source, message: DiagnosticSanitizer.Text(record.message), level: record.level as ErrorRecord["level"], process: "renderer", details: DiagnosticSanitizer.Details(record.details) };
		if (IsOperationFailure(record.failure)) safe.failure = { code: record.failure.code, kind: record.failure.kind, diagnosticId: record.failure.diagnosticId, operation: record.failure.operation, recovery: record.failure.recovery, outcome: record.failure.outcome, message: DiagnosticSanitizer.Text(record.failure.message) };
		Errors.Accept(safe);
	}
}
