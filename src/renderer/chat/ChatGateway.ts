import type { ChatConversationSnapshot, SendChatMessageCommand } from "../../shared/chat/ChatTypes.js";
import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";

// Stateless client of the reusable conversation IPC API.
export class ChatGateway
{
	// Loads the canonical saved transcript.
	public async OpenAsync(id: string): Promise<ChatConversationSnapshot | null>
	{
		const operation = window.chora.OpenChat(id);
		const snapshot = await ReadOperationAsync(operation);
		return snapshot;
	}
	// Awaits one durable response without interpreting errors in the transport layer.
	public async SendAsync(command: SendChatMessageCommand): Promise<ChatConversationSnapshot>
	{
		const operation = window.chora.SendChat(command);
		const snapshot = await ReadOperationAsync(operation);
		return snapshot;
	}
	// Sends cancellation through the existing operation envelope.
	public async CancelAsync(id: string): Promise<void>
	{
		const operation = window.chora.CancelChat(id);
		await ReadOperationAsync(operation);
	}
}
