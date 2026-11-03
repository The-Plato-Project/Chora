import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatoSiClient, PlatoSiRequestError } from "../../../src/main/platosi/PlatoSiClient.js";

/** Replaces process creation while exercising actual byte streams. */
const processMock = vi.hoisted(function CreateProcessMock()
{
	const mock = { spawn: vi.fn() };
	return mock;
});

vi.mock("node:child_process", function MockChildProcess()
{
	const module = { spawn: processMock.spawn };
	return module;
});

/** A request decoded by the in-memory service endpoint. */
interface FixtureRequest
{
	/** Requested protocol version. */
	version: number;
	/** Request correlation identifier. */
	id: string;
	/** Requested service operation. */
	operation: string;
	/** Operation-specific arguments. */
	payload: Record<string, unknown>;
}

/** A deterministic stdio peer that follows the PlatoSI wire protocol. */
class ProtocolPeer extends EventEmitter
{
	/** Input received from the client. */
	public readonly stdin = new PassThrough();
	/** Responses sent to the client. */
	public readonly stdout = new PassThrough();
	/** Diagnostics drained by the client. */
	public readonly stderr = new PassThrough();
	/** Requests received in wire order. */
	public readonly requests: FixtureRequest[] = [];
	/** Child process exit code. */
	public exitCode: number | null = null;
	/** Child process termination signal. */
	public signalCode: NodeJS.Signals | null = null;
	/** Whether termination was requested. */
	public killed = false;
	/** Whether closing stdin automatically exits successfully. */
	public autoExit = true;
	/** Incomplete incoming line. */
	private input = "";

	/** Attach input listeners to the peer's streams. */
	public constructor()
	{
		super();
		this.stdin.on("data", this.ReadInput.bind(this));
		this.stdin.on("finish", this.OnInputClosed.bind(this));
	}

	/** Decode complete request lines. */
	private ReadInput(chunk: Buffer): void
	{
		this.input += chunk.toString("utf8");
		let newline = this.input.indexOf("\n");
		while (newline !== -1)
		{
			const line = this.input.slice(0, newline);
			this.input = this.input.slice(newline + 1);
			const request = JSON.parse(line) as FixtureRequest;
			this.requests.push(request);
			newline = this.input.indexOf("\n");
		}
	}

	/** Complete the peer when the client closes input. */
	private OnInputClosed(): void
	{
		if (this.autoExit)
		{
			this.Exit(0, null);
		}
	}

	/** Simulate a process kill and subsequent close event. */
	public kill(): boolean
	{
		this.killed = true;
		this.Exit(null, "SIGTERM");
		return true;
	}

	/** Send an arbitrary terminal response. */
	public Reply(id: string, status: string, fields: Record<string, unknown> = {}): void
	{
		const response = { version: 1, id: id, status: status, ...fields };
		const json = JSON.stringify(response);
		this.stdout.write(`${json}\n`);
	}

	/** Complete the handshake with the service's actual system.info shape. */
	public Ready(): void
	{
		const request = this.requests[0];
		if (request === undefined)
		{
			throw new Error("Missing handshake.");
		}
		const result = { service: "PlatoSI", version: "0.1.0", protocol_version: 1, location_contract: "platosi.location.v1" };
		this.Reply(request.id, "ok", { result: result });
	}

	/** Notify the client of the process exit. */
	public Exit(code: number | null, signal: NodeJS.Signals | null): void
	{
		this.exitCode = code;
		this.signalCode = signal;
		this.emit("close", code, signal);
	}
}

/** Create a client attached to a fresh peer. */
function CreateClient(): { client: PlatoSiClient; peer: ProtocolPeer }
{
	const peer = new ProtocolPeer();
	processMock.spawn.mockReturnValue(peer);
	const client = new PlatoSiClient("python.exe", "C:\\PlatoSI\\scripts\\reader_api.py");
	const pair = { client: client, peer: peer };
	return pair;
}

/** Complete startup and return a ready client and its peer. */
async function CreateReadyClientAsync(): Promise<{ client: PlatoSiClient; peer: ProtocolPeer }>
{
	const pair = CreateClient();
	const start = pair.client.StartAsync();
	pair.peer.Ready();
	await start;
	return pair;
}

/** Reset test doubles before each protocol scenario. */
beforeEach(function ResetProcessMock()
{
	processMock.spawn.mockReset();
});

/** Restore real time after timeout scenarios. */
afterEach(function RestoreClock()
{
	vi.useRealTimers();
});

describe("PlatoSiClient", function PlatoSiClientTests()
{
	it("starts isolated Python and requires a compatible handshake", async function TestHandshake()
	{
		const pair = CreateClient();
		const start = pair.client.StartAsync();
		expect(processMock.spawn).toHaveBeenCalledWith(
			"python.exe",
			["-I", "-u", "C:\\PlatoSI\\scripts\\reader_api.py"],
			{ stdio: "pipe" }
		);
		expect(pair.peer.requests[0]).toEqual({ version: 1, id: "1", operation: "system.info", payload: {} });
		await expect(pair.client.RequestAsync("capabilities", {})).rejects.toThrow("not ready");
		pair.peer.Ready();
		await start;
		await pair.client.StopAsync();
	});

	it("correlates out-of-order responses and decodes fragmented UTF-8", async function TestCorrelation()
	{
		const pair = await CreateReadyClientAsync();
		const first = pair.client.RequestAsync("canonical.work", { dialogue: "republic" });
		const second = pair.client.RequestAsync("capabilities", {});
		const firstRequest = pair.peer.requests[1];
		const secondRequest = pair.peer.requests[2];
		if (firstRequest === undefined || secondRequest === undefined)
		{
			throw new Error("Missing requests.");
		}
		pair.peer.Reply(secondRequest.id, "ok", { result: ["ready"] });
		const response = { version: 1, id: firstRequest.id, status: "ok", result: "λόγος" };
		const line = Buffer.from(`${JSON.stringify(response)}\n`, "utf8");
		const split = line.indexOf(Buffer.from("λόγος", "utf8")) + 1;
		pair.peer.stdout.write(line.subarray(0, split));
		pair.peer.stdout.write(line.subarray(split));
		await expect(first).resolves.toBe("λόγος");
		await expect(second).resolves.toEqual(["ready"]);
		await pair.client.StopAsync();
	});

	it("surfaces terminal errors without confusing concurrent requests", async function TestErrors()
	{
		const pair = await CreateReadyClientAsync();
		const invalid = pair.client.RequestAsync("bad", {});
		const failed = pair.client.RequestAsync("unavailable", {});
		const cancelled = pair.client.RequestAsync("cancelled", {});
		const invalidAssertion = expect(invalid).rejects.toMatchObject({ Status: "invalid", message: "Invalid request" });
		const failedAssertion = expect(failed).rejects.toBeInstanceOf(PlatoSiRequestError);
		const cancelledAssertion = expect(cancelled).rejects.toMatchObject({ Status: "cancelled" });
		pair.peer.Reply(pair.peer.requests[1]!.id, "invalid", { error: "Invalid request" });
		pair.peer.Reply(pair.peer.requests[2]!.id, "failed", { error: "Unavailable" });
		pair.peer.Reply(pair.peer.requests[3]!.id, "cancelled");
		await invalidAssertion;
		await failedAssertion;
		await cancelledAssertion;
		await pair.client.StopAsync();
	});

	it("retains aborted request slots until terminal responses and handles cancellation acknowledgements", async function TestCancellation()
	{
		const pair = await CreateReadyClientAsync();
		const controller = new AbortController();
		const requests: Promise<unknown>[] = [];
		for (let index = 0; index < 16; index += 1)
		{
			const signal = index === 0 ? controller.signal : undefined;
			requests.push(pair.client.RequestAsync("work", {}, signal));
		}
		const aborted = expect(requests[0]).rejects.toMatchObject({ name: "AbortError" });
		controller.abort();
		await aborted;
		const target = pair.peer.requests[1]!;
		const cancellation = pair.peer.requests[17]!;
		expect(cancellation.operation).toBe("request.cancel");
		expect(cancellation.id).not.toBe(target.id);
		expect(cancellation.payload).toEqual({ id: target.id });
		await expect(pair.client.RequestAsync("extra", {})).rejects.toThrow("limit");
		pair.peer.Reply(cancellation.id, "ok", { result: { requested: true } });
		pair.peer.Reply(target.id, "cancelled");
		const extra = pair.client.RequestAsync("extra", {});
		pair.peer.Reply(pair.peer.requests[18]!.id, "ok", { result: 17 });
		await expect(extra).resolves.toBe(17);
		for (let index = 1; index < requests.length; index += 1)
		{
			pair.peer.Reply(pair.peer.requests[index + 1]!.id, "ok", { result: index });
		}
		await Promise.all(requests.slice(1));
		await pair.client.StopAsync();
	});

	it("rejects pre-aborted, oversized, and invalid requests without writing them", async function TestRequestValidation()
	{
		const pair = await CreateReadyClientAsync();
		const controller = new AbortController();
		controller.abort();
		await expect(pair.client.RequestAsync("work", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		await expect(pair.client.RequestAsync("work", { value: "x".repeat(2_000_000) })).rejects.toThrow("size limit");
		await expect(pair.client.RequestAsync("request.cancel", {})).rejects.toThrow("operation");
		await expect(pair.client.RequestAsync("work", [])).rejects.toThrow("object");
		expect(pair.peer.requests).toHaveLength(1);
		await pair.client.StopAsync();
	});

	it("rejects oversized or malformed responses and terminates the child", async function TestResponseValidation()
	{
		const pair = await CreateReadyClientAsync();
		const request = pair.client.RequestAsync("work", {});
		const assertion = expect(request).rejects.toThrow("size limit");
		pair.peer.stdout.write(Buffer.alloc(8_000_000, 65));
		await assertion;
		expect(pair.peer.killed).toBe(true);
		await expect(pair.client.StopAsync()).rejects.toThrow("size limit");

		const second = await CreateReadyClientAsync();
		const pending = second.client.RequestAsync("work", {});
		const invalid = expect(pending).rejects.toThrow("invalid protocol");
		second.peer.stdout.write(Buffer.from([0xff, 0x0a]));
		await invalid;
		await expect(second.client.StopAsync()).rejects.toThrow("invalid protocol");
	});

	it("fails on unsolicited responses and rejects all active operations", async function TestUnknownResponse()
	{
		const pair = await CreateReadyClientAsync();
		const first = pair.client.RequestAsync("work", {});
		const second = pair.client.RequestAsync("work", {});
		const firstFailure = expect(first).rejects.toThrow("invalid protocol");
		const secondFailure = expect(second).rejects.toThrow("invalid protocol");
		pair.peer.Reply("unknown", "ok", { result: null });
		await firstFailure;
		await secondFailure;
		expect(pair.peer.killed).toBe(true);
		await expect(pair.client.StopAsync()).rejects.toThrow("invalid protocol");
	});

	it("shares startup and interrupts pending work during graceful shutdown", async function TestLifecycle()
	{
		const pair = CreateClient();
		const firstStart = pair.client.StartAsync();
		const secondStart = pair.client.StartAsync();
		expect(processMock.spawn).toHaveBeenCalledTimes(1);
		pair.peer.Ready();
		await firstStart;
		await secondStart;
		const request = pair.client.RequestAsync("work", {});
		const interrupted = expect(request).rejects.toThrow("stopped");
		await pair.client.StopAsync();
		await interrupted;
		await expect(pair.client.RequestAsync("work", {})).rejects.toThrow("not ready");
		await expect(pair.client.StartAsync()).rejects.toThrow("not running");
	});

	it("rejects incompatible and stalled handshakes", async function TestStartupFailures()
	{
		const pair = CreateClient();
		const start = pair.client.StartAsync();
		const incompatible = expect(start).rejects.toThrow("incompatible");
		pair.peer.Reply(pair.peer.requests[0]!.id, "ok", {
			result: { service: "PlatoSI", protocol_version: 1, location_contract: "other.location.v1" }
		});
		await incompatible;
		await expect(pair.client.StopAsync()).rejects.toThrow("incompatible");

		vi.useFakeTimers();
		const stalled = CreateClient();
		const startup = stalled.client.StartAsync();
		const timeout = expect(startup).rejects.toThrow("timed out");
		await vi.advanceTimersByTimeAsync(10_000);
		await timeout;
		expect(stalled.peer.killed).toBe(true);
		await expect(stalled.client.StopAsync()).rejects.toThrow("timed out");
	});

	it("surfaces process errors and unsuccessful shutdowns", async function TestProcessFailures()
	{
		const pair = CreateClient();
		const start = pair.client.StartAsync();
		const failed = expect(start).rejects.toThrow("process failed");
		pair.peer.emit("error", new Error("spawn failed"));
		await failed;
		await expect(pair.client.StopAsync()).rejects.toThrow("process failed");

		const second = await CreateReadyClientAsync();
		second.peer.autoExit = false;
		const stopping = second.client.StopAsync();
		const exit = expect(stopping).rejects.toThrow("unsuccessfully");
		second.peer.Exit(2, null);
		await exit;
	});

	it("bounds shutdown when the service ignores EOF", async function TestShutdownTimeout()
	{
		vi.useFakeTimers();
		const pair = await CreateReadyClientAsync();
		pair.peer.autoExit = false;
		const stopping = pair.client.StopAsync();
		const timeout = expect(stopping).rejects.toThrow("shutdown timed out");
		await vi.advanceTimersByTimeAsync(5_000);
		await timeout;
		expect(pair.peer.killed).toBe(true);
	});
});
