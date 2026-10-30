export type ProviderId = "mock" | "kimi" | "copilot-relay" | "ollama";

export type ModelMessageRole = "user" | "assistant";

export interface ModelMessage
{
	role: ModelMessageRole;
	content: string;
}

export interface ModelRequest
{
	systemPrompt: string;
	userPrompt: string;
	history: ModelMessage[];
}

export type ModelDeltaHandler = (delta: string) => void;

export interface ModelUsage
{
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

export interface ModelResponse
{
	provider: ProviderId;
	model: string;
	rawText: string;
	requestId?: string;
	usage?: ModelUsage;
}

export interface ModelProvider
{
	readonly id: ProviderId;
	CompleteAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>;
}
