import * as http from "node:http";
import * as vscode from "vscode";

// Default loopback port used by Chora during local development.
const DefaultPort = 4319;
// Header required before the Relay may access the user's Copilot session.
const RelaySecretHeader = "x-copilot-relay-secret";

// JSON payload received from Chora when it requests a model completion.
interface PromptRequestBody
{
	prompt: string;
	modelFamily: string;
}

// JSON payload returned to Chora after a Copilot model completes.
interface PromptResponseBody
{
	text: string;
	modelFamily: string;
}

// JSON payload returned to Chora with available Copilot model families.
interface ModelCatalogueResponseBody
{
	modelFamilies: string[];
}

// Excludes VS Code-internal service models that cannot accept extension requests.
function IsChoraAccessibleModel(model: vscode.LanguageModelChat): boolean
{
	const family = model.family.trim();
	const isAccessible = family.length > 0 && !family.toLocaleLowerCase().startsWith("copilot-");

	return isAccessible;
}

// Owns local HTTP access to VS Code's authenticated Copilot model API.
class ChoraCopilotRelay
{
	// Output channel used to diagnose local Relay requests.
	private readonly output: vscode.OutputChannel;
	// Shared secret that authorizes the Chora desktop process.
	private readonly sharedSecret: string;
	// Local port on which the Relay listens.
	private readonly port: number;
	// Active server while the extension is running.
	private server: http.Server | undefined;

	// Creates the Relay from the Chora-owned VS Code configuration.
	public constructor(output: vscode.OutputChannel, sharedSecret: string, port: number)
	{
		this.output = output;
		this.sharedSecret = sharedSecret;
		this.port = port;
	}

	// Starts the authenticated local Relay server.
	public Start(): void
	{
		const handler = this.HandleServerRequest.bind(this);
		this.server = http.createServer(handler);
		this.server.listen(this.port, "127.0.0.1");
		this.output.appendLine(`Chora Copilot Relay listening on http://127.0.0.1:${this.port}`);
	}

	// Stops the local Relay server during extension shutdown.
	public Stop(): void
	{
		this.server?.close();
	}

	// Routes one HTTP request from the Chora desktop process.
	private HandleServerRequest(request: http.IncomingMessage, response: http.ServerResponse): void
	{
		void this.HandleRequestAsync(request, response);
	}

	// Authorizes and dispatches one local Relay request.
	private async HandleRequestAsync(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>
	{
		const isAuthorized = this.IsAuthorized(request);

		if (!isAuthorized)
		{
			this.SendJson(response, 401, { error: "Unauthorized" });
		}
		else if (request.method === "GET" && request.url === "/health")
		{
			this.SendJson(response, 200, { status: "ok" });
		}
		else if (request.method === "GET" && request.url === "/models")
		{
			await this.HandleModelsAsync(response);
		}
		else if (request.method === "POST" && request.url === "/prompt")
		{
			await this.HandlePromptAsync(request, response);
		}
		else
		{
			this.SendJson(response, 404, { error: "Not found" });
		}
	}

	// Lists the Copilot model families available in the active VS Code session.
	private async HandleModelsAsync(response: http.ServerResponse): Promise<void>
	{
		try
		{
			const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
			const families = new Set<string>();

			for (const model of models)
			{
				const family = model.family.trim();

				if (IsChoraAccessibleModel(model))
				{
					families.add(family);
				}
			}

			const modelFamilies = [...families];
			modelFamilies.sort();
			const payload: ModelCatalogueResponseBody = { modelFamilies };
			this.SendJson(response, 200, payload);
		}
		catch (error)
		{
			this.SendError(response, "Could not list Copilot models", error);
		}
	}

	// Sends one Chora prompt to its selected Copilot model.
	private async HandlePromptAsync(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>
	{
		try
		{
			const bodyText = await this.ReadBodyAsync(request);
			const body = JSON.parse(bodyText) as PromptRequestBody;
			const model = await this.SelectModelAsync(body.modelFamily);
			const messages = [vscode.LanguageModelChatMessage.User(body.prompt)];
			const cancellation = new vscode.CancellationTokenSource();
			const completion = await model.sendRequest(messages, {}, cancellation.token);
			let text = "";

			for await (const fragment of completion.text)
			{
				text += fragment;
			}

			const payload: PromptResponseBody = {
				text,
				modelFamily: model.family
			};
			this.SendJson(response, 200, payload);
		}
		catch (error)
		{
			this.SendError(response, "Could not complete Copilot request", error);
		}
	}

	// Selects exactly the requested Copilot family without silently switching models.
	private async SelectModelAsync(modelFamily: string): Promise<vscode.LanguageModelChat>
	{
		const requestedFamily = modelFamily.trim();
		const selector = requestedFamily.length > 0 ? { vendor: "copilot", family: requestedFamily } : { vendor: "copilot" };
		const models = await vscode.lm.selectChatModels(selector);
		const model = models.find(IsChoraAccessibleModel);

		if (model === undefined)
		{
			const message = requestedFamily.length > 0 ? `Copilot model family is unavailable: ${requestedFamily}` : "No Copilot model is available.";
			throw new Error(message);
		}

		return model;
	}

	// Checks the local shared secret before accessing the VS Code Copilot session.
	private IsAuthorized(request: http.IncomingMessage): boolean
	{
		const header = request.headers[RelaySecretHeader];
		const requestSecret = typeof header === "string" ? header : "";
		const hasSecret = this.sharedSecret.length > 0;
		const isAuthorized = hasSecret && requestSecret === this.sharedSecret;

		return isAuthorized;
	}

	// Reads the complete JSON body from a Chora Relay request.
	private async ReadBodyAsync(request: http.IncomingMessage): Promise<string>
	{
		const chunks: Buffer[] = [];

		for await (const chunk of request)
		{
			chunks.push(chunk as Buffer);
		}

		const body = Buffer.concat(chunks).toString("utf8");

		return body;
	}

	// Logs a server failure and writes a stable JSON error response.
	private SendError(response: http.ServerResponse, prefix: string, error: unknown): void
	{
		const message = error instanceof Error ? error.message : String(error);
		this.output.appendLine(`${prefix}: ${message}`);
		this.SendJson(response, 500, { error: message });
	}

	// Writes one JSON response to a local Chora Relay client.
	private SendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void
	{
		const body = JSON.stringify(payload);

		response.writeHead(statusCode, { "Content-Type": "application/json" });
		response.end(body);
	}
}

// Activates the Chora-owned Relay extension.
export function activate(context: vscode.ExtensionContext): void
{
	const output = vscode.window.createOutputChannel("Chora Copilot Relay");
	const configuration = vscode.workspace.getConfiguration("choraCopilotRelay");
	const sharedSecret = configuration.get<string>("sharedSecret", "").trim();
	const port = configuration.get<number>("port", DefaultPort);
	const relay = new ChoraCopilotRelay(output, sharedSecret, port);
	const disposeRelay = new vscode.Disposable(relay.Stop.bind(relay));

	relay.Start();
	context.subscriptions.push(output);
	context.subscriptions.push(disposeRelay);
}

// Deactivation is handled by the registered Relay disposable.
export function deactivate(): void
{
}