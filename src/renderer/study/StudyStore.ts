import type { StudyConversation, StudyUpdate } from "../../shared/study/StudyTypes.js";

// One work's chat state stays separate from every other work and from editor state.
export interface StudyWorkState
{
	// Stable canonical work identity.
	readonly workId: string;
	// Reader-facing work label inherited from the Library.
	readonly title: string;
	// Host-owned transcript, or null before the first message.
	readonly conversation: StudyConversation | null;
	// Unsent reader text retained across work navigation.
	readonly draft: string;
	// Prevents duplicate submissions while loading or generating.
	readonly busy: boolean;
	// Inline availability or operation feedback.
	readonly status: string;
}

// Mutable representation remains private to the state owner.
type StudyWorkRecord = { -readonly [Key in keyof StudyWorkState]: StudyWorkState[Key] };

// Sole renderer owner of per-work conversation and draft state.
export class StudyStore
{
	// Conversations are keyed by canonical work identity, never by the active DOM.
	private readonly works = new Map<string, StudyWorkRecord>();
	// The Library controls which work is currently displayed.
	private workId: string | null = null;

	// Selects the open work without losing another work's draft or history.
	public Select(workId: string, title: string): void
	{
		if (!this.works.has(workId)) this.works.set(workId, { workId, title, conversation: null, draft: "", busy: false, status: "" });
		this.workId = workId;
	}

	// Returns the current work projection without reading any document bodies.
	public GetSnapshot(): StudyWorkState | null
	{
		const result = this.workId === null ? null : this.works.get(this.workId) ?? null;
		return result;
	}

	// Finds the captured origin of an asynchronous operation.
	public GetWork(workId: string): StudyWorkState
	{
		const state = this.RequireWork(workId);
		return state;
	}

	// Updates operation feedback on the captured origin rather than whichever work is visible.
	public SetStatus(workId: string, status: string, busy: boolean): void
	{
		const state = this.RequireWork(workId);
		state.status = status;
		state.busy = busy;
	}

	// Retains unsent writing without publishing an application-wide change per keystroke.
	public SetDraft(workId: string, draft: string): void
	{
		const state = this.RequireWork(workId);
		state.draft = draft;
	}

	// Exposes mutable records only inside this state owner.
	private RequireWork(workId: string): StudyWorkRecord
	{
		const state = this.works.get(workId);
		if (state === undefined) throw new Error("The work has no chat state.");
		return state;
	}

	// Applies authoritative history only to its owning work.
	public SetConversation(workId: string, conversation: StudyConversation | null): void
	{
		const state = this.RequireWork(workId);
		if (conversation !== null && conversation.scope.workId !== workId) throw new Error("The conversation belongs to another work.");
		state.conversation = conversation;
	}

	// Shows outgoing text immediately while the host lazily opens execution.
	public BeginTurn(workId: string, text: string, model: string): void
	{
		const state = this.RequireWork(workId);
		const conversation = state.conversation ?? { id: "", scope: { workId }, model, messages: [], sources: [] };
		state.conversation = { ...conversation, messages: [...conversation.messages,
			{ role: "reader", text, status: "complete" }, { role: "interlocutor", text: "", status: "partial" }] };
		state.draft = "";
		state.busy = true;
		state.status = "Responding…";
	}

	// Routes chunks to their captured work and discards retired conversation identities.
	public Apply(update: StudyUpdate): void
	{
		const state = this.works.get(update.workId);
		const conversation = state?.conversation;
		if (state !== undefined && state.busy && conversation !== undefined && conversation !== null
			&& (conversation.id === "" || conversation.id === update.conversationId))
		{
			if (update.kind === "text" || update.kind === "replace")
			{
				const messages = [...conversation.messages];
				const index = messages.length - 1;
				const last = messages[index];
				if (last?.role === "interlocutor") messages[index] = { ...last, text: update.kind === "replace" ? update.text : last.text + update.text };
				state.conversation = { ...conversation, id: update.conversationId, messages };
			}
			else state.status = update.text;
		}
	}
}
