import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type { StudyBackend, StudyToolEndpoint } from "../StudyBackend.js";
import type { StudyUpdate } from "../../../shared/study/StudyTypes.js";
import { ApplicationError } from "../../../shared/diagnostics/OperationResult.js";

// Pinned Windows release whose explicit extension-selection behavior has been inspected.
const GooseDigest = "5a424ab992d75aaefdc54ccf27719f62c3995e6d9b283d1cca016ec4d4b055ef";

// Isolates Goose process/configuration and translates ACP into application-owned events.
export class GooseStudyBackend implements StudyBackend
{
	// Native handles never escape this adapter.
	private child: ChildProcessWithoutNullStreams | null = null;
	// Owns the active ACP stream and pending requests.
	private connection: acp.ClientConnection | null = null;
	// Binds this adapter to one private Goose session.
	private sessionId: string | null = null;
	// Isolates backend configuration and local session files.
	private profile: string | null = null;
	// Delivers application-owned visible updates without exposing protocol objects.
	private publish: ((update: Omit<StudyUpdate, "conversationId">) => void) | null = null;
	// Contains the exact verified read-tool names for this conversation.
	private readonly allowed = new Set<string>();
	// Permission updates can omit metadata already delivered by the initial tool notification.
	private readonly toolIdentities = new Map<string, string>();
	// Bounds accumulated response or evidence characters for the current turn.
	private output = 0;
	// A disposed adapter cannot resume launch after an awaited configuration read.
	private disposed = false;
	// Reads no configuration and launches no process until OpenAsync.
	public constructor(private readonly executable: string, private readonly root: string, private readonly directives: string)
	{
	}

	// Pins the runtime, creates a fresh profile, and verifies the actual effective tool list.
	public async OpenAsync(model: string, tools: StudyToolEndpoint, publish: (update: Omit<StudyUpdate, "conversationId">) => void): Promise<void>
	{
		if (process.platform !== "win32" || !path.isAbsolute(this.executable)) throw ApplicationError.Expected("validation", "GOOSE_RUNTIME_NOT_CONFIGURED", "Run scripts/InstallGoose.ps1, configure CHORA_GOOSE_BINARY in .env.local, and restart Chora. This experiment currently supports Windows x64.");
		const executableBytes = await fs.readFile(this.executable);
		const hash = createHash("sha256");
		hash.update(executableBytes);
		const digest = hash.digest("hex");
		if (digest !== GooseDigest) throw ApplicationError.Expected("validation", "GOOSE_RUNTIME_MISMATCH", "The Goose runtime does not match the verified release. Run scripts/InstallGoose.ps1 again.");
		await fs.mkdir(this.root, { recursive: true });
		this.profile = await fs.mkdtemp(path.join(this.root, "session-"));
		const config = path.join(this.profile, "config");
		await fs.mkdir(config);
		await fs.writeFile(path.join(config, "config.yaml"), "extensions: {}\n", "utf8");
		const instructions = path.join(this.profile, "interlocutor.md");
		await fs.writeFile(instructions, this.directives, "utf8");
		// Allowlisted environment excludes provider secrets, proxies and inherited Goose settings.
		const env: NodeJS.ProcessEnv = {};
		for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
		{
			if (process.env[key] !== undefined) env[key] = process.env[key];
		}
		env.GOOSE_PATH_ROOT = this.profile;
		env.GOOSE_PROVIDER = "ollama";
		env.GOOSE_MODEL = model;
		env.OLLAMA_HOST = "http://127.0.0.1:11434";
		env.GOOSE_MODE = "approve";
		env.GOOSE_DISABLE_SESSION_NAMING = "1";
		env.GOOSE_MAX_TURNS = "12";
		env.GOOSE_INPUT_LIMIT = "16384";
		env.GOOSE_MAX_TOKENS = "4096";
		env.GOOSE_THINKING_EFFORT = "off";
		env.GOOSE_MOIM_MESSAGE_FILE = instructions;
		env.CONTEXT_FILE_NAMES = "[]";
		env.GOOSE_TELEMETRY_ENABLED = "false";
		env.DO_NOT_TRACK = "1";
		this.publish = publish;
		for (const name of tools.names) this.allowed.add(`chora__${name}`);
		try
		{
			if (this.disposed) throw new Error("The conversation was stopped during startup.");
			const child = spawn(this.executable, ["acp"], { cwd: this.profile, env, windowsHide: true, stdio: "pipe" });
			this.child = child;
			// Backend logs can contain prompts; drain without forwarding them into application diagnostics.
			child.stderr.resume();
			child.on("error", this.HandleExit.bind(this));
			child.on("exit", this.HandleExit.bind(this));
			const client = acp.client({ name: "chora" });
			client.onNotification(acp.methods.client.session.update, this.HandleUpdate.bind(this));
			client.onRequest(acp.methods.client.session.requestPermission, this.HandlePermission.bind(this));
			// Node and the DOM library describe the same native Web stream with different iterator members.
			const input = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
			const output = Writable.toWeb(child.stdin);
			const stream = acp.ndJsonStream(output, input);
			const connection = client.connect(stream);
			this.connection = connection;
			const startup = this.InitializeAsync(connection, tools, model);
			await this.WithDeadlineAsync(startup, 30000);
		}
		catch
		{
			this.Dispose();
			throw ApplicationError.Expected("conflict", "GOOSE_START_FAILED", "Goose could not start with the restricted Chora tools and selected model. Check the verified runtime and local Ollama model; no conversation was sent.");
		}
	}

	// Explicit Goose metadata replaces all default, configured and plugin extensions.
	private async InitializeAsync(connection: acp.ClientConnection, tools: StudyToolEndpoint, model: string): Promise<void>
	{
		const initialized = await connection.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
		if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) throw new Error("Unsupported ACP version.");
		const session = await connection.agent.request(acp.methods.agent.session.new, {
			cwd: this.profile!, mcpServers: [],
			_meta: {
				sessionTitle: "The Athenian Stranger", enabledExtensions: [
					{ type: "mcp", server: { type: "http", name: "chora", url: tools.url, headers: [{ name: "Authorization", value: `Bearer ${tools.token}` }] } }
				]
			}
		});
		this.sessionId = session.sessionId;
		const selected = session.configOptions?.find(function IsModel(option): boolean
		{
			const result = option.category === "model";
			return result;
		});
		if (selected === undefined || selected.type !== "select" || selected.currentValue !== model) throw new Error("Goose did not select the requested local model.");
		const result = await connection.agent.request<{ tools: { name: string }[] }>("_goose/unstable/tools/list", { sessionId: session.sessionId });
		if (!Array.isArray(result.tools) || result.tools.length !== this.allowed.size) throw new Error("Unexpected effective tools.");
		for (const tool of result.tools)
		{
			if (!this.allowed.has(tool.name)) throw new Error("An undeclared tool is active.");
		}
	}

	// Bounds a turn independently of the backend's own provider timeouts.
	public async PromptAsync(text: string): Promise<void>
	{
		if (this.connection === null || this.sessionId === null) throw new Error("Start a new conversation before sending a message.");
		this.output = 0;
		this.toolIdentities.clear();
		const pending = this.connection.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [{ type: "text", text }] });
		const result = await this.WithDeadlineAsync(pending, 300000);
		if (result.stopReason !== "end_turn" || this.output === 0) throw new Error("The model stopped before completing a visible response.");
	}

	// ACP cancellation is followed by host revocation at the service boundary.
	public async CancelAsync(): Promise<void>
	{
		if (this.connection !== null && this.sessionId !== null)
		{
			await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
		}
	}

	// Synchronous shutdown leaves no reusable tool credentials or process handles.
	public Dispose(): void
	{
		this.disposed = true;
		this.publish = null;
		this.connection?.close();
		this.connection = null;
		this.sessionId = null;
		this.child?.kill();
		this.child = null;
		this.allowed.clear();
		this.toolIdentities.clear();
	}

	// Only verified read tools can receive an affirmative per-call permission.
	private HandlePermission(context: { params: acp.RequestPermissionRequest }): acp.RequestPermissionResponse
	{
		const call = context.params.toolCall;
		const option = context.params.options.find(function Once(item): boolean
		{
			const result = item.kind === "allow_once";
			return result;
		});
		const identity = this.ToolName(call._meta);
		const name = identity ?? this.toolIdentities.get(call.toolCallId);
		let result: acp.RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
		if (typeof name === "string" && this.allowed.has(name) && option !== undefined) result = { outcome: { outcome: "selected", optionId: option.optionId } };
		return result;
	}

	// Ignores model thoughts and routes only visible text and bounded tool activity.
	private HandleUpdate(context: { params: acp.SessionNotification }): void
	{
		if (context.params.sessionId === this.sessionId)
		{
			const update = context.params.update;
			if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
			{
				this.output += update.content.text.length;
				if (this.output > 64000) this.Dispose();
				else this.publish?.({ kind: "text", text: update.content.text });
			}
			else if (update.sessionUpdate === "tool_call")
			{
				const name = this.ToolName(update._meta);
				if (name !== null && this.allowed.has(name)) this.toolIdentities.set(update.toolCallId, name);
				this.publish?.({ kind: "tool", text: "Reading permitted evidence…" });
			}
		}
	}

	// Uses Goose's structured provenance rather than parsing a generated display title.
	private ToolName(meta: unknown): string | null
	{
		let name: string | null = null;
		if (typeof meta === "object" && meta !== null && "goose" in meta)
		{
			const goose = meta.goose;
			if (typeof goose === "object" && goose !== null && "toolCall" in goose)
			{
				const identity = goose.toolCall;
				if (typeof identity === "object" && identity !== null && "toolName" in identity && typeof identity.toolName === "string") name = identity.toolName;
			}
		}
		return name;
	}

	// Process failure rejects ACP requests without exposing backend stderr or private data.
	private HandleExit(): void
	{
		this.connection?.close(new Error("The local Goose process stopped."));
	}

	// Clears timeout ownership on every completion and kills a nonresponsive runtime.
	private async WithDeadlineAsync<T>(pending: Promise<T>, milliseconds: number): Promise<T>
	{
		let timer: ReturnType<typeof setTimeout> | undefined;
		const backend = this;
		function Deadline(_resolve: (value: T) => void, reject: (error: Error) => void): void
		{
			function Expired(): void
			{
				backend.Dispose();
				reject(new Error("The local interlocutor timed out. Start a new conversation to retry."));
			}
			timer = setTimeout(Expired, milliseconds);
		}
		const deadline = new Promise<T>(Deadline);
		let result: T;
		try
		{
			result = await Promise.race([pending, deadline]);
		}
		finally
		{
			clearTimeout(timer);
		}
		return result;
	}
}
