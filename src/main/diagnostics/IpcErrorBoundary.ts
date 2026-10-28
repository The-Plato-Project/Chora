import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { OperationFailure, OperationResult } from "../../shared/diagnostics/OperationResult.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { Errors } from "./MainErrorManager.js";

// Registers privileged commands with one failure envelope and diagnostic correlation policy.
export class IpcErrorBoundary
{
	// Adapts synchronous and asynchronous handlers without logging renderer request arguments.
	public static Register<TArgs extends unknown[], T>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: TArgs) => T | Promise<T>): void
	{
		// Keeps original exceptions in the privileged process and sends safe failure metadata to the renderer.
		async function HandleAsync(event: IpcMainInvokeEvent, ...args: TArgs): Promise<OperationResult<T>>
		{
			let response: OperationResult<T>;
			try
			{
				const value = await handler(event, ...args);
				response = { ok: true, value };
			}
			catch (error)
			{
				response = { ok: false, error: IpcErrorBoundary.Capture(channel, error) };
			}

			return response;
		}
		ipcMain.handle(channel, HandleAsync);
	}

	// Shares failure translation with main-process event-based operations.
	public static Capture(operation: string, error: unknown): OperationFailure
	{
		const classified = this.Classify(error, operation);
		const record = Errors.Capture(operation, error, classified);
		const failure = { ...classified, diagnosticId: record.id, operation };

		return failure;
	}

	// Maps known infrastructure failures by code, never by matching exception message text.
	private static Classify(error: unknown, operation: string): OperationFailure
	{
		let failure: OperationFailure = { kind: "unexpected", code: "UNEXPECTED_FAILURE", message: "The operation could not finish. Your current state should be checked before trying again.", recovery: "inspect-state", outcome: "unknown", diagnosticId: "", operation };
		if (error instanceof ApplicationError) failure = { ...error.failure, operation };
		else if (error instanceof Error && error.name === "AbortError") failure = { ...failure, kind: "cancelled", code: "CANCELLED", message: "The operation was cancelled.", recovery: "none", outcome: "not-completed" };
		else if (error !== null && typeof error === "object" && "code" in error)
		{
			const code = String(error.code);
			if (["EACCES", "EPERM", "EBUSY", "ENOSPC", "ENOENT", "EIO", "EROFS"].includes(code))
			{
				failure = { ...failure, kind: "io", code, message: code === "ENOSPC" ? "There is not enough disk space to finish the operation." : "A required file could not be accessed. Check storage, file permissions, or synchronization activity.", recovery: "inspect-state" };
			}
			else if (["configuration", "authentication", "rate-limit", "network", "timeout", "malformed-response", "mock-failure"].includes(code))
			{
				failure = { ...failure, kind: "provider", code: `PROVIDER_${code.toUpperCase().replaceAll("-", "_")}`, message: "The model provider could not complete the request. Check provider configuration or availability.", recovery: code === "configuration" || code === "authentication" ? "correct-input" : "retry", outcome: "not-completed" };
			}
		}

		return failure;
	}
}
