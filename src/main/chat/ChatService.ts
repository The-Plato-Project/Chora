import { randomUUID } from "node:crypto";
import type { ChatContextSnapshot, ChatConversationSnapshot, ChatMessage, SendChatMessageCommand } from "../../shared/chat/ChatTypes.js";
import type { ModelMessage, ModelResponse } from "../../shared/models/ModelTypes.js";
import type { ModelSelection } from "../../shared/models/ModelSelection.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { PromptLoader } from "../prompts/PromptLoader.js";
import { ModelApi } from "../models/ModelApi.js";
import { ChatRepository } from "./ChatRepository.js";
import type { ChatContextSource } from "./ChatContextSource.js";

// Owns reusable conversation execution, persistence ordering and cancellation.
export class ChatService
{
	// Admits one request per scope before any asynchronous setup starts.
	private readonly active = new Map<string, AbortController>();
	// Prevents new operations after shutdown begins.
	private stopped = false;

	// Feature context is supplied through an explicit main-process collaborator.
	public constructor(private readonly repository: ChatRepository, private readonly source: ChatContextSource, private readonly promptName: string, private readonly models: ModelApi = new ModelApi(), private readonly prompts: PromptLoader = new PromptLoader())
	{
	}

	// Reads persisted history without retaining or recapturing feature content.
	public async OpenAsync(id: unknown): Promise<ChatConversationSnapshot | null>
	{
		ChatRepository.ValidateId(id);
		const conversationId: string = id;
		let snapshot = await this.repository.LoadAsync(conversationId);
		if (snapshot !== null)
		{
			const messages: ChatMessage[] = [];
			for (const message of snapshot.messages)
			{
				const status = message.status === "pending" || message.status === "streaming" ? "interrupted" : message.status;
				messages.push({ ...message, status });
			}
			snapshot = { ...snapshot, messages };
			await this.repository.SaveAsync(snapshot);
		}
		return snapshot;
	}

	// Accepts narrow commands; all history and reading context are resolved in main.
	public async SendAsync(value: unknown): Promise<ChatConversationSnapshot>
	{
		const command = value as SendChatMessageCommand | null;
		if (command === null || typeof command !== "object") throw ApplicationError.Expected("validation", "INVALID_CHAT_COMMAND", "Enter a message to continue.");
		ChatRepository.ValidateId(command.conversationId);
		ChatRepository.ValidateId(command.clientRequestId);
		if (typeof command.content !== "string" || command.content.trim().length === 0 || command.content.length > 16000) throw ApplicationError.Expected("validation", "INVALID_CHAT_MESSAGE", "Enter a message of up to 16,000 characters.");
		if (this.stopped || this.active.has(command.conversationId)) throw ApplicationError.Expected("conflict", "CHAT_BUSY", "A response is already in progress for this conversation.");
		const abort = new AbortController();
		this.active.set(command.conversationId, abort);
		const self = this;
		async function ExecuteAsync(context: ChatContextSnapshot): Promise<ChatConversationSnapshot>
		{
			const selection = await self.models.ResolveSelectionAsync(command!.model, abort.signal);
			abort.signal.throwIfAborted();
			const saved = await self.repository.LoadAsync(command!.conversationId);
			let snapshot: ChatConversationSnapshot = saved ?? { id: command!.conversationId, scope: context.scope, model: selection, messages: [], contexts: [] };
			const previous = snapshot.messages.find(function Match(message): boolean { return message.id === command!.clientRequestId; });
			const alreadyCompleted = previous !== undefined && snapshot.messages.some(function Completed(message): boolean { return message.turnId === previous.turnId && message.role === "assistant" && message.status === "completed"; });
			if (previous !== undefined && previous.content !== command!.content.trim()) throw ApplicationError.Expected("conflict", "CHAT_REQUEST_REUSED", "This send request already belongs to a different message.");
			if (!alreadyCompleted)
			{
				const turnId = previous?.turnId ?? randomUUID();
				const messages: ChatMessage[] = [];
				for (const message of snapshot.messages)
				{
					if (message.turnId !== turnId) messages.push(message);
				}
				const retainedContextIds = new Set(messages.map(function SelectContextId(message): string
				{
					return message.contextId;
				}));
				const contexts = snapshot.contexts.filter(function IsReferenced(candidate): boolean
				{
					return retainedContextIds.has(candidate.id);
				});
				const createdAt = new Date().toISOString();
				messages.push({ id: command!.clientRequestId, turnId, role: "user", content: command!.content.trim(), status: "completed", contextId: context.id, createdAt, model: null, usage: null });
				const responseId = randomUUID();
				messages.push({ id: responseId, turnId, role: "assistant", content: "", status: "pending", contextId: context.id, createdAt, model: selection, usage: null });
				snapshot = { ...snapshot, model: selection, messages, contexts: [...contexts, context] };
				const request = self.BuildRequest(snapshot, command!.content.trim(), turnId);
				const systemPrompt = await self.prompts.LoadAsync(self.promptName);
				await self.repository.SaveAsync(snapshot);
				let response: ModelResponse | null = null;
				let failure: unknown = null;
				try
				{
					abort.signal.throwIfAborted();
					response = await self.models.CompleteAsync(selection, { ...request, systemPrompt }, undefined, abort.signal);
					if (response.rawText.trim().length === 0 || response.rawText.length > 120000) throw new Error("The model returned an empty or oversized reply.");
				}
				catch (error)
				{
					failure = error;
				}
				const status = abort.signal.aborted ? "cancelled" : failure !== null ? "failed" : "completed";
				const completed: ChatMessage[] = [];
				for (const message of snapshot.messages)
				{
					if (message.id === responseId)
					{
						const model: ModelSelection = response === null ? selection : { provider: response.provider, model: response.model };
						completed.push({ ...message, status, content: response?.rawText ?? "", model, usage: response?.usage ?? null });
					}
					else completed.push(message);
				}
				snapshot = { ...snapshot, messages: completed };
				await self.repository.SaveAsync(snapshot);
				if (failure !== null && !abort.signal.aborted) throw failure;
			}
			return snapshot;
		}
		let snapshot: ChatConversationSnapshot;
		try
		{
			const context = await this.source.CaptureAsync(command.conversationId, command.selection);
			abort.signal.throwIfAborted();
			snapshot = await ExecuteAsync(context);
		}
		finally
		{
			this.active.delete(command.conversationId);
		}
		return snapshot;
	}

	// Stops only a matching active conversation without acquiring its mutation lease.
	public Cancel(id: unknown): void
	{
		ChatRepository.ValidateId(id);
		this.active.get(id)?.abort();
	}

	// Aborts all model I/O before module shutdown.
	public Stop(): void
	{
		this.stopped = true;
		for (const abort of this.active.values()) abort.abort();
	}

	// Preserves historical contexts and rejects oversized requests rather than silently truncating.
	private BuildRequest(snapshot: ChatConversationSnapshot, content: string, turnId: string): { history: ModelMessage[]; userPrompt: string }
	{
		const history: ModelMessage[] = [];
		let size = 0;
		let userPrompt = "";
		for (const message of snapshot.messages)
		{
			if (message.role === "user")
			{
				const context = snapshot.contexts.find(function Match(candidate): boolean { return candidate.id === message.contextId; });
				const material = JSON.stringify({ readingContext: context?.content ?? "", readerMessage: message.content });
				size += material.length;
				if (message.turnId === turnId) userPrompt = material;
				else history.push({ role: "user", content: material });
			}
			else if (message.status === "completed")
			{
				history.push({ role: "assistant", content: message.content });
				size += message.content.length;
			}
		}
		if (size > 240000) throw ApplicationError.Expected("validation", "CHAT_HISTORY_LIMIT", "This conversation exceeds the current request limit. Its history remains saved.");
		const request = { history, userPrompt: userPrompt || content };
		return request;
	}
}
