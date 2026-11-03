import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { TextDecoder } from "node:util";

/** Protocol limits include the terminating newline. */
const MAX_REQUEST_BYTES = 2_000_000;
/** Maximum size of one complete response. */
const MAX_RESPONSE_BYTES = 8_000_000;
/** Maximum number of active service operations. */
const MAX_PENDING = 16;
/** Maximum time allowed for the readiness handshake. */
const START_TIMEOUT_MS = 10_000;
/** Maximum time allowed for cooperative shutdown. */
const STOP_TIMEOUT_MS = 5_000;

/** A request awaiting its terminal response. */
interface PendingRequest
{
	/** Completes the caller's operation. */
	resolve: (value: unknown) => void;
	/** Reports the operation's failure. */
	reject: (error: Error) => void;
	/** Optional caller-owned cancellation signal. */
	signal: AbortSignal | undefined;
	/** Listener installed on the cancellation signal. */
	abort: (() => void) | undefined;
	/** Whether the caller has already been notified of cancellation. */
	cancelled: boolean;
}

/** The observed termination of the owned child process. */
interface ProcessExit
{
	/** Exit status reported by Node. */
	code: number | null;
	/** Signal reported by Node. */
	signal: NodeJS.Signals | null;
}

/** A terminal protocol error returned by PlatoSI. */
export class PlatoSiRequestError extends Error
{
	/** The protocol's terminal status. */
	public readonly Status: "invalid" | "failed" | "cancelled";

	/** Preserve the service status and its explanation. */
	public constructor(status: "invalid" | "failed" | "cancelled", message: string)
	{
		super(message);
		this.name = "PlatoSiRequestError";
		this.Status = status;
	}
}

/** Owns one isolated PlatoSI process and its versioned stdio connection. */
export class PlatoSiClient
{
	/** Python interpreter used to launch the service. */
	private readonly pythonExecutable: string;
	/** Absolute path to the PlatoSI reader API script. */
	private readonly scriptPath: string;
	/** Current process lifecycle. */
	private state: "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed" = "idle";
	/** Owned process, once launched. */
	private child: ChildProcessWithoutNullStreams | undefined;
	/** Shared startup operation. */
	private startPromise: Promise<void> | undefined;
	/** Shared shutdown operation. */
	private stopPromise: Promise<void> | undefined;
	/** Process-close notification. */
	private exitPromise: Promise<ProcessExit> | undefined;
	/** Resolves the process-close notification. */
	private resolveExit: ((exit: ProcessExit) => void) | undefined;
	/** Fatal process or protocol failure, if any. */
	private failure: Error | undefined;
	/** Whether the process emitted diagnostics, without retaining their contents. */
	private hasDiagnostics = false;
	/** Monotonic request identifier sequence. */
	private nextId = 0;
	/** Active operations, including locally aborted operations awaiting termination. */
	private readonly pending = new Map<string, PendingRequest>();
	/** Cancellation acknowledgement identifiers. */
	private readonly cancellations = new Set<string>();
	/** Bounded storage for the current response line. */
	private lineBuffer: Buffer = Buffer.alloc(0);
	/** Current response line size, excluding its newline. */
	private lineBytes = 0;

	/** Configure the interpreter and the installed reader API script. */
	public constructor(pythonExecutable: string, scriptPath: string)
	{
		this.pythonExecutable = pythonExecutable;
		this.scriptPath = scriptPath;
	}

	/** Launch the process and wait for a compatible system.info response. */
	public async StartAsync(): Promise<void>
	{
		if (this.state === "idle")
		{
			this.state = "starting";
			this.startPromise = this.StartProcessAsync();
		}
		if (this.startPromise === undefined)
		{
			const error = new Error("PlatoSI client cannot be started in its current state.");
			throw error;
		}
		await this.startPromise;
		if (this.state !== "ready")
		{
			let failure = this.failure;
			if (failure === undefined)
			{
				failure = new Error("PlatoSI client is not running.");
			}
			throw failure;
		}
	}

	/** Send an operation and correlate its terminal response by request ID. */
	public async RequestAsync(operation: string, payload: object, signal?: AbortSignal): Promise<unknown>
	{
		if (this.state !== "ready")
		{
			let failure = this.failure;
			if (failure === undefined)
			{
				failure = new Error("PlatoSI client is not ready.");
			}
			throw failure;
		}
		if (typeof operation !== "string" || operation.length === 0 || operation === "request.cancel")
		{
			const error = new Error("A valid PlatoSI operation is required.");
			throw error;
		}
		const isArray = Array.isArray(payload);
		if (payload === null || typeof payload !== "object" || isArray)
		{
			const error = new Error("PlatoSI payload must be an object.");
			throw error;
		}
		const result = await this.SendAsync(operation, payload, signal);
		return result;
	}

	/** Close stdin, wait for the service, and force termination if it does not exit. */
	public async StopAsync(): Promise<void>
	{
		if (this.stopPromise === undefined)
		{
			this.stopPromise = this.StopProcessAsync();
		}
		await this.stopPromise;
	}

	/** Start the child and perform the bounded readiness handshake. */
	private async StartProcessAsync(): Promise<void>
	{
		try
		{
			const pythonExecutable = this.pythonExecutable.trim();
			if (pythonExecutable.length === 0)
			{
				const error = new Error("Configure PLATOSI_PYTHON and PLATOSI_READER_API before starting Chora.");
				throw error;
			}
			const scriptPath = this.scriptPath.trim();
			if (scriptPath.length === 0)
			{
				const error = new Error("Configure PLATOSI_PYTHON and PLATOSI_READER_API before starting Chora.");
				throw error;
			}
			const child = spawn(this.pythonExecutable, ["-I", "-u", this.scriptPath], { stdio: "pipe" });
			this.child = child;
			const client = this;
			this.exitPromise = new Promise<ProcessExit>(function CaptureExit(resolve)
			{
				client.resolveExit = resolve;
			});
			const onOutput = this.OnOutput.bind(this);
			const onStreamError = this.OnStreamError.bind(this);
			const onDiagnostic = this.OnDiagnostic.bind(this);
			const onProcessError = this.OnProcessError.bind(this);
			const onClose = this.OnClose.bind(this);
			const onStartTimeout = this.OnStartTimeout.bind(this);
			child.stdout.on("data", onOutput);
			child.stdout.on("error", onStreamError);
			child.stderr.on("data", onDiagnostic);
			child.stderr.on("error", onStreamError);
			child.stdin.on("error", onStreamError);
			child.on("error", onProcessError);
			child.on("close", onClose);
			const timeout = setTimeout(onStartTimeout, START_TIMEOUT_MS);
			try
			{
				const info = await this.SendAsync("system.info", {}, undefined);
				const isArray = Array.isArray(info);
				if (typeof info !== "object" || info === null || isArray)
				{
					const error = new Error("PlatoSI returned an invalid system.info response.");
					throw error;
				}
				const record = info as Record<string, unknown>;
				if (record.service !== "PlatoSI" || record.protocol_version !== 1
					|| record.location_contract !== "platosi.location.v1")
				{
					const error = new Error("PlatoSI reported an incompatible protocol.");
					throw error;
				}
				if (this.state !== "starting")
				{
					let failure = this.failure;
					if (failure === undefined)
					{
						failure = new Error("PlatoSI startup was interrupted.");
					}
					throw failure;
				}
				this.state = "ready";
			}
			finally
			{
				clearTimeout(timeout);
			}
		}
		catch (error)
		{
			let failure: Error;
			if (error instanceof Error)
			{
				failure = error;
			}
			else
			{
				failure = new Error("PlatoSI startup failed.");
			}
			if (this.state !== "stopping" && this.state !== "stopped")
			{
				this.Fail(failure);
			}
			throw failure;
		}
	}

	/** Register and write one protocol request. */
	private async SendAsync(operation: string, payload: object, signal: AbortSignal | undefined): Promise<unknown>
	{
		if (signal?.aborted)
		{
			const error = this.CreateAbortError();
			throw error;
		}
		if (this.pending.size >= MAX_PENDING)
		{
			const error = new Error("PlatoSI request limit reached.");
			throw error;
		}
		const id = this.NewId();
		const request = { version: 1, id: id, operation: operation, payload: payload };
		const line = this.EncodeRequest(request);
		const child = this.child;
		if (child === undefined || child.stdin.destroyed || !child.stdin.writable)
		{
			const error = new Error("PlatoSI input is not writable.");
			throw error;
		}
		const client = this;
		const result = new Promise<unknown>(function RegisterRequest(resolve, reject)
		{
			const pending: PendingRequest = { resolve: resolve, reject: reject, signal: signal, abort: undefined, cancelled: false };
			if (signal !== undefined)
			{
				pending.abort = function AbortRequest()
				{
					client.Cancel(id);
				};
				signal.addEventListener("abort", pending.abort, { once: true });
			}
			client.pending.set(id, pending);
			try
			{
				child.stdin.write(line);
				if (signal?.aborted)
				{
					client.Cancel(id);
				}
			}
			catch (error)
			{
				let failure: Error;
				if (error instanceof Error)
				{
					failure = error;
				}
				else
				{
					failure = new Error("PlatoSI input failed.");
				}
				client.Fail(failure);
			}
		});
		const value = await result;
		return value;
	}

	/** Request cooperative cancellation while retaining the active operation slot. */
	private Cancel(id: string): void
	{
		const pending = this.pending.get(id);
		if (pending !== undefined && !pending.cancelled)
		{
			pending.cancelled = true;
			this.RemoveAbortListener(pending);
			const abortError = this.CreateAbortError();
			pending.reject(abortError);
			try
			{
				if (this.cancellations.size >= MAX_PENDING)
				{
					const error = new Error("PlatoSI cancellation acknowledgement limit reached.");
					throw error;
				}
				const cancelId = this.NewId();
				const request = { version: 1, id: cancelId, operation: "request.cancel", payload: { id: id } };
				const line = this.EncodeRequest(request);
				const child = this.child;
				if (child === undefined || child.stdin.destroyed || !child.stdin.writable)
				{
					const error = new Error("PlatoSI input is not writable.");
					throw error;
				}
				this.cancellations.add(cancelId);
				child.stdin.write(line);
			}
			catch (error)
			{
				let failure: Error;
				if (error instanceof Error)
				{
					failure = error;
				}
				else
				{
					failure = new Error("PlatoSI cancellation failed.");
				}
				this.Fail(failure);
			}
		}
	}

	/** Encode one bounded UTF-8 protocol line. */
	private EncodeRequest(request: object): Buffer
	{
		const json = JSON.stringify(request);
		const text = `${json}\n`;
		const line = Buffer.from(text, "utf8");
		if (line.length > MAX_REQUEST_BYTES)
		{
			const error = new Error("PlatoSI request exceeds the protocol size limit.");
			throw error;
		}
		return line;
	}

	/** Allocate a unique identifier for this process. */
	private NewId(): string
	{
		this.nextId += 1;
		const id = String(this.nextId);
		return id;
	}

	/** Accumulate bounded byte lines before decoding complete UTF-8 messages. */
	private OnOutput(chunk: Buffer): void
	{
		if (this.state === "starting" || this.state === "ready")
		{
			let start = 0;
			while (start < chunk.length && (this.state === "starting" || this.state === "ready"))
			{
				const newline = chunk.indexOf(10, start);
				const end = newline === -1 ? chunk.length : newline;
				const part = chunk.subarray(start, end);
				this.lineBytes += part.length;
				const responseBytes = this.lineBytes + 1;
				if (responseBytes > MAX_RESPONSE_BYTES)
				{
					const error = new Error("PlatoSI response exceeds the protocol size limit.");
					this.Fail(error);
				}
				else
				{
					if (this.lineBuffer.length < this.lineBytes)
					{
						const doubledLength = this.lineBuffer.length * 2;
						const desiredCapacity = Math.max(this.lineBytes, doubledLength, 1024);
						const capacity = Math.min(MAX_RESPONSE_BYTES, desiredCapacity);
						const buffer = Buffer.allocUnsafe(capacity);
						const previousBytes = this.lineBytes - part.length;
						this.lineBuffer.copy(buffer, 0, 0, previousBytes);
						this.lineBuffer = buffer;
					}
					const previousBytes = this.lineBytes - part.length;
					part.copy(this.lineBuffer, previousBytes);
					if (newline !== -1)
					{
						const line = this.lineBuffer.subarray(0, this.lineBytes);
						this.lineBytes = 0;
						this.HandleLine(line);
					}
				}
				start = newline === -1 ? chunk.length : newline + 1;
			}
		}
	}

	/** Validate and route a complete protocol response. */
	private HandleLine(line: Buffer): void
	{
		try
		{
			const decoder = new TextDecoder("utf-8", { fatal: true });
			const text = decoder.decode(line);
			const value: unknown = JSON.parse(text);
			const isArray = Array.isArray(value);
			if (typeof value !== "object" || value === null || isArray)
			{
				const error = new Error("Invalid PlatoSI response.");
				throw error;
			}
			const response = value as Record<string, unknown>;
			if (response.version !== 1 || typeof response.id !== "string" || typeof response.status !== "string")
			{
				const error = new Error("Invalid PlatoSI response envelope.");
				throw error;
			}
			const id = response.id;
			const isCancellation = this.cancellations.delete(id);
			if (isCancellation)
			{
				if (response.status !== "ok" || typeof response.result !== "object" || response.result === null ||
					typeof (response.result as Record<string, unknown>).requested !== "boolean")
				{
					const error = new Error("PlatoSI cancellation acknowledgement failed.");
					throw error;
				}
			}
			else
			{
				this.CompleteRequest(id, response);
			}
		}
		catch
		{
			const error = new Error("PlatoSI returned an invalid protocol response.");
			this.Fail(error);
		}
	}

	/** Complete the matching operation without accepting unsolicited responses. */
	private CompleteRequest(id: string, response: Record<string, unknown>): void
	{
		const pending = this.pending.get(id);
		if (pending === undefined)
		{
			const error = new Error("PlatoSI returned an unknown request ID.");
			throw error;
		}
		const status = response.status;
		if (status !== "ok" && status !== "invalid" && status !== "failed" && status !== "cancelled")
		{
			const error = new Error("PlatoSI returned an invalid response status.");
			throw error;
		}
		const hasResult = Object.hasOwn(response, "result");
		if (status === "ok" && !hasResult)
		{
			const error = new Error("PlatoSI response is missing its result.");
			throw error;
		}
		if ((status === "invalid" || status === "failed") && typeof response.error !== "string")
		{
			const error = new Error("PlatoSI response is missing its error.");
			throw error;
		}
		this.pending.delete(id);
		this.RemoveAbortListener(pending);
		if (!pending.cancelled)
		{
			if (status === "ok")
			{
				pending.resolve(response.result);
			}
			else
			{
				const message = typeof response.error === "string" ? response.error : "PlatoSI request was cancelled.";
				const error = new PlatoSiRequestError(status, message);
				pending.reject(error);
			}
		}
	}

	/** Remove an operation's abort subscription. */
	private RemoveAbortListener(pending: PendingRequest): void
	{
		if (pending.signal !== undefined && pending.abort !== undefined)
		{
			pending.signal.removeEventListener("abort", pending.abort);
			pending.abort = undefined;
		}
	}

	/** Construct the conventional cancellation error. */
	private CreateAbortError(): Error
	{
		const error = new Error("PlatoSI request was aborted.");
		error.name = "AbortError";
		return error;
	}

	/** Record diagnostic presence without retaining or logging potentially sensitive content. */
	private OnDiagnostic(chunk: Buffer): void
	{
		if (chunk.length > 0)
		{
			this.hasDiagnostics = true;
			if (this.failure !== undefined)
			{
				this.AddDiagnosticIndicator(this.failure);
			}
		}
	}

	/** Indicate that diagnostics existed without exposing their contents. */
	private AddDiagnosticIndicator(error: Error): void
	{
		const indicator = " PlatoSI emitted stderr; its contents were not retained.";
		const alreadyReported = error.message.includes(indicator);
		if (this.hasDiagnostics && !alreadyReported)
		{
			error.message += indicator;
		}
	}

	/** Treat transport errors as fatal without exposing stream contents. */
	private OnStreamError(error: Error): void
	{
		if (this.state !== "stopped")
		{
			const failure = new Error("PlatoSI stream failed.", { cause: error });
			this.Fail(failure);
		}
	}

	/** Surface child process creation and execution errors. */
	private OnProcessError(error: Error): void
	{
		const failure = new Error("PlatoSI process failed.", { cause: error });
		this.Fail(failure);
	}

	/** Fail a startup that never completes its handshake. */
	private OnStartTimeout(): void
	{
		const error = new Error("PlatoSI startup timed out.");
		this.Fail(error);
	}

	/** Reject all outstanding requests and terminate a broken connection. */
	private Fail(error: Error): void
	{
		if (this.failure === undefined)
		{
			this.failure = error;
		}
		this.AddDiagnosticIndicator(this.failure);
		if (this.state !== "stopped")
		{
			this.state = "failed";
		}
		for (const pending of this.pending.values())
		{
			this.RemoveAbortListener(pending);
			if (!pending.cancelled)
			{
				pending.reject(this.failure);
			}
		}
		this.pending.clear();
		this.cancellations.clear();
		this.lineBuffer = Buffer.alloc(0);
		this.lineBytes = 0;
		if (this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null)
		{
			this.child.kill();
		}
	}

	/** Record process termination and reject unexpected exits. */
	private OnClose(code: number | null, signal: NodeJS.Signals | null): void
	{
		if (this.state !== "stopping" && this.state !== "stopped" && this.state !== "failed")
		{
			const message = `PlatoSI process exited unexpectedly (code ${code}, signal ${signal}).`;
			const error = new Error(message);
			this.Fail(error);
		}
		if (this.resolveExit !== undefined)
		{
			const exit = { code: code, signal: signal };
			this.resolveExit(exit);
			this.resolveExit = undefined;
		}
	}

	/** Stop the child once, including while startup or requests are in progress. */
	private async StopProcessAsync(): Promise<void>
	{
		const child = this.child;
		const exitPromise = this.exitPromise;
		if (child === undefined || exitPromise === undefined)
		{
			this.state = "stopped";
		}
		else
		{
			if (this.state !== "failed")
			{
				this.state = "stopping";
			}
			const stopped = new Error("PlatoSI client stopped.");
			for (const pending of this.pending.values())
			{
				this.RemoveAbortListener(pending);
				if (!pending.cancelled)
				{
					pending.reject(stopped);
				}
			}
			this.pending.clear();
			this.cancellations.clear();
			if (!child.stdin.destroyed)
			{
				child.stdin.end();
			}
			let timer: NodeJS.Timeout | undefined;
			const client = this;
			const timeout = new Promise<ProcessExit>(function WaitForShutdown(_resolve, reject)
			{
				timer = setTimeout(function ForceShutdown()
				{
					const error = new Error("PlatoSI shutdown timed out.");
					client.AddDiagnosticIndicator(error);
					reject(error);
					child.kill();
				}, STOP_TIMEOUT_MS);
			});
			try
			{
				const exit = await Promise.race([exitPromise, timeout]);
				if (this.failure !== undefined)
				{
					throw this.failure;
				}
				if (exit.code !== 0 || exit.signal !== null)
				{
					const message = `PlatoSI process exited unsuccessfully (code ${exit.code}, signal ${exit.signal}).`;
					const error = new Error(message);
					this.AddDiagnosticIndicator(error);
					throw error;
				}
				this.state = "stopped";
			}
			finally
			{
				clearTimeout(timer);
			}
		}
	}
}
