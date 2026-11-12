import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool, type CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { StudyEvidence } from "./StudyEvidence.js";
import type { StudyToolEndpoint } from "./StudyBackend.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";

// Closed tool catalogue; annotations describe read behavior without granting authority.
export const StudyTools: readonly Tool[] = [
	{ name: "find_topic_passages", description: "Controlled topic retrieval in the current canonical work. Propose one to four Greek dictionary headwords, each with a tentative reason. The host looks up dictionary evidence and all supplied lemma-form occurrences, preserving ambiguity. Four candidate sections/page in canonical order; follow nextOffset if needed. Dictionary evidence does not establish contextual sense or thematic significance. Inspect explicit expressions and clear juxtapositions; never invent hidden meanings.", inputSchema: { type: "object", properties: { terms: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", properties: { lemma: { type: "string", maxLength: 80, description: "One Greek dictionary headword only. No spaces, parentheses, transliteration or apostrophes. Example: χρόνος." }, reason: { type: "string", maxLength: 240 } }, required: ["lemma", "reason"], additionalProperties: false } }, offset: { type: "integer", minimum: 0 } }, required: ["terms"], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: "read_passage", description: "Read the current work's exact Greek section, including surrounding speech and action. Offset paginates long sections. Cite only returned text; use double quotes around exact Greek excerpts.", inputSchema: { type: "object", properties: { stephanus: { type: "string" }, offset: { type: "integer", minimum: 0 } }, required: ["stephanus"], additionalProperties: false }, annotations: { readOnlyHint: true } }
];

// Owns a session-scoped authenticated MCP listener, never accessible on external interfaces.
export class StudyToolServer
{
	// A random capability is rotated for every new conversation.
	private readonly token = randomBytes(32).toString("hex");
	// Owns the revocable session-scoped evidence listener.
	private readonly server: HttpServer;
	// Tracks active MCP connections for immediate revocation.
	private readonly transports = new Set<StreamableHTTPServerTransport>();
	// Rejects further authenticated requests once the grant is revoked.
	private closed = false;
	// Bounds simultaneous authenticated HTTP operations.
	private requests = 0;
	// Binds no socket until the reader explicitly opens a conversation.
	public constructor(private readonly evidence: StudyEvidence)
	{
		this.server = createServer(this.Handle.bind(this));
	}

	// Starts on an OS-assigned port and returns the revocable capability.
	public async StartAsync(): Promise<StudyToolEndpoint>
	{
		const server = this.server;
		function Listen(resolve: () => void, reject: (error: Error) => void): void
		{
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		}
		await new Promise<void>(Listen);
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("The evidence listener could not start.");
		const names = StudyTools.map(function Name(tool): string
		{
			return tool.name;
		});
		const endpoint = { url: `http://127.0.0.1:${address.port}/mcp`, token: this.token, names };
		return endpoint;
	}

	// Revokes authorization synchronously before closing active HTTP connections.
	public Dispose(): void
	{
		this.closed = true;
		this.evidence.EndTurn();
		for (const transport of this.transports) void transport.close();
		this.transports.clear();
		this.server.closeAllConnections();
		this.server.close();
	}

	// Keeps asynchronous transport failures out of Node's unhandled-rejection path.
	private Handle(request: IncomingMessage, response: ServerResponse): void
	{
		void this.HandleAsync(request, response);
	}

	// Uses the official MCP transport after authentication, size and concurrency checks.
	private async HandleAsync(request: IncomingMessage, response: ServerResponse): Promise<void>
	{
		let transport: StreamableHTTPServerTransport | null = null;
		let mcp: Server | null = null;
		let counted = false;
		try
		{
			if (this.closed || request.headers.authorization !== `Bearer ${this.token}` || request.url !== "/mcp" || request.headers.origin !== undefined)
			{
				response.writeHead(403);
				response.end();
			}
			else if (request.method !== "POST" || this.requests >= 4)
			{
				response.writeHead(429);
				response.end();
			}
			else
			{
				this.requests += 1;
				counted = true;
				request.setTimeout(15000, request.destroy.bind(request));
				const buffers: Buffer[] = [];
				let size = 0;
				for await (const chunk of request)
				{
					const buffer = Buffer.from(chunk);
					size += buffer.length;
					if (size > 16384) throw new Error("Tool request too large.");
					buffers.push(buffer);
				}
				const bytes = Buffer.concat(buffers);
				const body: unknown = JSON.parse(bytes.toString("utf8"));
				mcp = new Server({ name: "chora-evidence", version: "1.0.0" }, { capabilities: { tools: {} } });
				async function ListAsync(): Promise<{ tools: Tool[] }>
				{
					const result = { tools: [...StudyTools] };
					return result;
				}
				const evidence = this.evidence;
				async function CallAsync(toolRequest: CallToolRequest): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>
				{
					let result;
					try
					{
						const text = await evidence.CallAsync(toolRequest.params.name, toolRequest.params.arguments ?? {});
						result = { content: [{ type: "text" as const, text }] };
					}
					catch (error)
					{
						const text = error instanceof ApplicationError && error.failure.kind === "validation"
							? JSON.stringify({ status: "invalid-input-not-searched", code: error.failure.code, message: error.failure.message })
							: "The tool failed or access was revoked. This is not a successful search or evidence that a word or passage is absent. Do not invent results or diagnose missing dictionary coverage from this error.";
						result = { content: [{ type: "text" as const, text }], isError: true };
					}
					return result;
				}
				mcp.setRequestHandler(ListToolsRequestSchema, ListAsync);
				mcp.setRequestHandler(CallToolRequestSchema, CallAsync);
				transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
				this.transports.add(transport);
				// SDK accessors include undefined while its own Transport interface uses exact optional members.
				const binding = transport as Transport;
				await mcp.connect(binding);
				await transport.handleRequest(request, response, body);
			}
		}
		catch
		{
			if (!response.headersSent) response.writeHead(400);
			response.end();
		}
		finally
		{
			if (counted) this.requests -= 1;
			if (transport !== null) this.transports.delete(transport);
			await mcp?.close();
		}
	}
}
