import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool, type CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { StudyEvidence } from "./StudyEvidence.js";
import type { StudyToolEndpoint } from "./StudyBackend.js";

// Closed tool catalogue; annotations describe read behavior without granting authority.
export const StudyTools: readonly Tool[] = [
	{ name: "search_text", description: "Search the current work's canonical Greek text, NOT Visions. Use this first for requests to find places/passages in the Republic or another open work. Translate topic labels into plausible Greek words/stems, search alternatives, then inspect read_passage. terms matches ANY substring, ignoring accents/case/final sigma. Six sections/page; follow nextOffset. Lexical candidates are not exhaustive conceptual search. Cite actual retrieved sections.", inputSchema: { type: "object", properties: { terms: { type: "array", items: { type: "string", maxLength: 80 }, minItems: 1, maxItems: 8 }, offset: { type: "integer", minimum: 0 } }, required: ["terms"], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: "find_visions", description: "List or search all saved Visions in the current work. Empty query lists documents; use nextOffset to continue. Read each relevant document with read_vision before claiming knowledge of it.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 120 }, offset: { type: "integer", minimum: 0 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: "read_vision", description: "Read a 6,000-character window of an approved saved Vision. Cite its ID and savedRevision. Follow nextOffset for more.", inputSchema: { type: "object", properties: { visionId: { type: "string" }, offset: { type: "integer", minimum: 0 } }, required: ["visionId"], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: "read_passage", description: "Read one canonical Stephanus section of the approved work. Cite work, textVersion and stephanus.", inputSchema: { type: "object", properties: { stephanus: { type: "string" } }, required: ["stephanus"], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: "resolve_anchor", description: "Validate an existing exact anchor in the approved work. Never invent anchor or placement IDs.", inputSchema: { type: "object", properties: { anchorId: { type: "string" } }, required: ["anchorId"], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: "get_word_evidence", description: "Exact-word evidence. Default overview returns all lemma candidates, morphology status and dictionary entry labels. section dictionary reads one entryIndex at character offset; section occurrences requires a candidate lemma and paginates at offset. Preserve uncertainty. selection requires dialogue, text_version, start/end {stephanus,offset}.", inputSchema: { type: "object", properties: { selection: { type: "object" }, section: { type: "string", enum: ["overview", "dictionary", "occurrences"] }, lemma: { type: "string" }, entryIndex: { type: "integer", minimum: 0 }, offset: { type: "integer", minimum: 0 } }, required: ["selection"], additionalProperties: false }, annotations: { readOnlyHint: true } }
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
					catch
					{
						result = { content: [{ type: "text" as const, text: "Evidence unavailable: the reference is invalid, outside the approved scope, revoked, or exceeds the turn budget. Do not invent a replacement." }], isError: true };
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
