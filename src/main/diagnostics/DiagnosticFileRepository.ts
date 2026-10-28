import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { ErrorRecord } from "../../shared/diagnostics/DiagnosticManager.js";

// Owns one serialized JSON-lines log with bounded file rotation.
export class DiagnosticFileRepository
{
	// Pending appends and rotations, flushed during graceful shutdown.
	private pending: Promise<void> = Promise.resolve();
	// Bounds the number of outstanding log appends under repeated failure bursts.
	private queued = 0;
	// Prevents recursive or repeated reporting when the log destination is unavailable.
	private failureReported = false;
	// Most recent storage failure, exposed to the main diagnostic owner.
	public StorageError: string | null = null;

	// Creates a repository at an application-owned logs directory.
	public constructor(private readonly directory: string)
	{
	}

	// Serializes one append behind all earlier writes without rejecting the original application operation.
	public Append(record: ErrorRecord): void
	{
		const repository = this;
		const line = JSON.stringify(record) + "\n";
		// Keeps record order even when the previous append failed.
		async function WriteAsync(): Promise<void>
		{
			try
			{
				await repository.WriteAsync(line);
				repository.StorageError = null;
			}
			catch (error)
			{
				repository.StorageError = error instanceof Error ? error.message : String(error);
				if (!repository.failureReported)
				{
					repository.failureReported = true;
					console.error("[Chora][Diagnostics] Persistent logging is unavailable; recent diagnostics remain in memory.");
				}
			}
		}
		if (this.queued < 1000)
		{
			this.queued += 1;
			// Releases backlog capacity after the append either succeeded or reported its storage failure.
			async function WriteAndReleaseAsync(): Promise<void>
			{
				try { await WriteAsync(); }
				finally { repository.queued -= 1; }
			}
			this.pending = this.pending.then(WriteAndReleaseAsync);
		}
		else
		{
			this.StorageError = "Diagnostic queue capacity exceeded; some persistent records were omitted.";
			if (!this.failureReported)
			{
				this.failureReported = true;
				console.error("[Chora][Diagnostics] Diagnostic backlog is full; recent records remain in memory.");
			}
		}
	}

	// Waits for every append already admitted by the diagnostic owner.
	public async FlushAsync(): Promise<void>
	{
		await this.pending;
	}

	// Rotates at five MiB, retaining the current file and three archived files.
	private async WriteAsync(line: string): Promise<void>
	{
		await mkdir(this.directory, { recursive: true });
		const filePath = path.join(this.directory, "chora.jsonl");
		let size = 0;
		try
		{
			const info = await stat(filePath);
			size = info.size;
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (size + Buffer.byteLength(line) > 5 * 1024 * 1024)
		{
			await this.RemoveOptionalAsync(`${filePath}.3`);
			for (let index = 2; index >= 1; index -= 1) await this.MoveOptionalAsync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
			await this.MoveOptionalAsync(filePath, `${filePath}.1`);
		}
		await appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
	}

	// Removes only one known rotation archive when it exists.
	private async RemoveOptionalAsync(filePath: string): Promise<void>
	{
		try { await unlink(filePath); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}

	// Moves only known log files, tolerating an absent earlier archive.
	private async MoveOptionalAsync(source: string, target: string): Promise<void>
	{
		try { await rename(source, target); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}
