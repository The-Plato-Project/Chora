import type { StudyConversation, StudyUpdate } from "../../shared/study/StudyTypes.js";

// Sole renderer owner of interlocutor history and execution state.
export class StudyStore
{
	// State remains private; panels observe immutable snapshots.
	private conversation: StudyConversation | null = null;
	// Prevents a second operation while the current one is pending.
	private busy = false;
	// Distinguishes a usable runtime from passive transcript history.
	private connected = false;
	// Communicates execution availability independently of transcript content.
	private status = "Disabled. Choose context and start a local conversation.";
	// Projects feature state without involving reader or editor stores.
	public GetSnapshot(): { conversation: StudyConversation | null; busy: boolean; connected: boolean; status: string }
	{
		const snapshot = { conversation: this.conversation, busy: this.busy, connected: this.connected, status: this.status };
		return snapshot;
	}
	// Replaces authoritative host history and its current execution availability.
	public SetConversation(conversation: StudyConversation | null, connected: boolean): void
	{
		this.conversation = conversation;
		this.connected = connected;
	}
	// Communicates operation state without modifying the transcript.
	public SetStatus(status: string, busy: boolean): void
	{
		this.status = status;
		this.busy = busy;
	}
	// Shows reader text immediately and reserves one partial response for streaming.
	public BeginTurn(text: string): void
	{
		if (this.conversation !== null)
		{
			this.conversation = {
				...this.conversation, messages: [...this.conversation.messages,
				{ role: "reader", text, status: "complete" }, { role: "interlocutor", text: "", status: "partial" }]
			};
		}
	}
	// Ignores stale or unrelated backend updates rather than refreshing application state.
	public Apply(update: StudyUpdate): void
	{
		if (this.busy && update.conversationId === this.conversation?.id)
		{
			if (update.kind === "text")
			{
				const messages = [...this.conversation.messages];
				const index = messages.length - 1;
				const message = messages[index];
				if (message?.role === "interlocutor") messages[index] = { ...message, text: message.text + update.text };
				this.conversation = { ...this.conversation, messages };
			}
			else this.status = update.text;
		}
	}
}
