import { mkdir, readFile, rename, unlink, writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ChatConversationSnapshot } from "../../shared/chat/ChatTypes.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";

// Owns atomic conversation files; callers serialize operations per scope.
export class ChatRepository
{
	// Uses only a main-owned storage directory.
	public constructor(private readonly directory: string)
	{
	}

	// Rejects identifiers before they can participate in a path.
	public static ValidateId(id: unknown): asserts id is string
	{
		if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id))
		{
			throw ApplicationError.Expected("validation", "INVALID_CHAT_ID", "The conversation identity is invalid.");
		}
	}

	// Validates both persisted files and conversation payloads retained in Trash.
	public static Decode(value: unknown, id: string): ChatConversationSnapshot
	{
		ChatRepository.ValidateId(id);
		const record = value as ChatConversationSnapshot | null;
		if (record === null || typeof record !== "object" || record.id !== id || record.scope?.kind !== "dream" || record.scope.id !== id || !Array.isArray(record.messages) || !Array.isArray(record.contexts) || record.messages.length > 2000 || record.contexts.length > 1000)
		{
			throw new Error("Conversation storage is invalid. The saved file has been retained.");
		}
		ChatRepository.ValidateModel(record.model);
		const contextIds = new Set<string>();
		for (const context of record.contexts)
		{
			ChatRepository.ValidateId(context?.id);
			if (contextIds.has(context.id) || context.scope?.kind !== "dream" || context.scope.id !== id || typeof context.content !== "string" || context.content.length > 120000 || typeof context.revision !== "string" || typeof context.capturedAt !== "string") throw new Error("Conversation context is invalid.");
			contextIds.add(context.id);
		}
		const messageIds = new Set<string>();
		for (const message of record.messages)
		{
			ChatRepository.ValidateId(message?.id);
			ChatRepository.ValidateId(message.turnId);
			if (messageIds.has(message.id) || !contextIds.has(message.contextId) || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 120000 || typeof message.createdAt !== "string" || !["pending", "streaming", "completed", "cancelled", "failed", "interrupted"].includes(message.status)) throw new Error("Conversation message is invalid.");
			if (message.model !== null) ChatRepository.ValidateModel(message.model);
			messageIds.add(message.id);
		}
		const snapshot = structuredClone(record);
		return snapshot;
	}

	// Accepts only known transport families and bounded model names.
	private static ValidateModel(value: unknown): void
	{
		const model = value as { provider?: unknown; model?: unknown } | null;
		if (model === null || typeof model !== "object"
			|| typeof model.provider !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(model.provider)
			|| typeof model.model !== "string" || model.model.length === 0 || model.model.length > 128)
		{
			throw new Error("Conversation model is invalid.");
		}
	}

	// Loads one scope without treating malformed or inaccessible files as empty chats.
	public async LoadAsync(id: string): Promise<ChatConversationSnapshot | null>
	{
		const file = this.Resolve(id);
		let conversation: ChatConversationSnapshot | null = null;
		try
		{
			const metadata = await stat(file);
			if (metadata.size > 16000000) throw new Error("The conversation file exceeds the supported size.");
			const content = await readFile(file, "utf8");
			const value: unknown = JSON.parse(content);
			const envelope = value as { version?: unknown; conversation?: unknown } | null;
			if (envelope?.version !== 1) throw new Error("Unsupported conversation storage version. The saved file has been retained.");
			conversation = ChatRepository.Decode(envelope.conversation, id);
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return conversation;
	}

	// Commits a complete authoritative transcript through an atomic sibling replacement.
	public async SaveAsync(conversation: ChatConversationSnapshot): Promise<void>
	{
		const snapshot = ChatRepository.Decode(conversation, conversation.id);
		const content = JSON.stringify({ version: 1, conversation: snapshot });
		if (Buffer.byteLength(content, "utf8") > 16000000) throw ApplicationError.Expected("validation", "CHAT_STORAGE_LIMIT", "This conversation has reached its storage limit. Preserve it before continuing.");
		await mkdir(this.directory, { recursive: true });
		const destination = this.Resolve(snapshot.id);
		const temporary = `${destination}.${randomUUID()}.tmp`;
		try
		{
			await writeFile(temporary, content, "utf8");
			await rename(temporary, destination);
		}
		finally
		{
			await this.RemoveFileAsync(temporary);
		}
	}

	// Removes a live conversation after its recoverable payload has been staged.
	public async DeleteAsync(id: string): Promise<void>
	{
		const file = this.Resolve(id);
		await this.RemoveFileAsync(file);
	}

	// Ignores only an already absent file, preserving actionable filesystem failures.
	private async RemoveFileAsync(file: string): Promise<void>
	{
		try
		{
			await unlink(file);
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	// Constructs a filename solely from a validated canonical identity.
	private Resolve(id: string): string
	{
		ChatRepository.ValidateId(id);
		const file = path.join(this.directory, `${id}.json`);
		return file;
	}
}
