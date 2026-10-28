import { BrowserWindow } from "electron";
import { DiagnosticManager, type ErrorRecord } from "../../shared/diagnostics/DiagnosticManager.js";
import { DiagnosticFileRepository } from "./DiagnosticFileRepository.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";

// Owns durable diagnostic storage and main-process notifications.
class MainErrorManager extends DiagnosticManager
{
	// Main-process-only filesystem boundary for persistent records.
	private repository: DiagnosticFileRepository | null = null;

	// Attaches logging once Electron has resolved the application logs path.
	public Configure(directory: string): void
	{
		if (this.repository === null)
		{
			this.repository = new DiagnosticFileRepository(directory);
			for (const record of this.GetRecords()) this.Store(record);
		}
	}

	// Flushes all admitted writes before graceful process shutdown.
	public async FlushAsync(): Promise<void>
	{
		await this.repository?.FlushAsync();
	}

	// Reports storage health without attempting to log a logging failure recursively.
	public GetStorageError(): string | null
	{
		const error = this.repository?.StorageError ?? null;
		return error;
	}

	// Persists new records and forwards only explicit main-process notifications to the application window.
	protected override OnRecord(record: ErrorRecord, persist: boolean): void
	{
		if (persist) this.Store(record);
		if (record.userMessage !== undefined && record.process !== "renderer")
		{
			for (const window of BrowserWindow.getAllWindows())
			{
				if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.diagnosticReported, { id: record.id, timestamp: record.timestamp, level: record.level, source: record.source, message: record.userMessage, userMessage: record.userMessage, failure: record.failure });
			}
		}
	}

	// Removes configured credentials before console, memory, disk, or renderer publication.
	protected override PrepareRecord(record: ErrorRecord): ErrorRecord
	{
		let serialized = JSON.stringify(record);
		for (const [key, value] of Object.entries(process.env))
		{
			if (/key|secret|token|password/iu.test(key) && value !== undefined && value.length >= 6)
			{
				const escaped = JSON.stringify(value).slice(1, -1);
				serialized = serialized.split(escaped).join("<redacted>");
			}
		}
		const safe = JSON.parse(serialized) as ErrorRecord;

		return safe;
	}

	// Writes only process-owned, serializable records into the existing repository.
	private Store(record: ErrorRecord): void
	{
		this.repository?.Append({ ...record, process: record.process ?? "main" });
	}
}

// Existing main-process diagnostic entry point shared by every feature.
export const Errors = new MainErrorManager();
