import type { ChatConversationSnapshot } from "../../shared/chat/ChatTypes.js";
import type { ModelSelection } from "../../shared/models/ModelSelection.js";

// Transient reader message shown before main acknowledges persistence.
export interface PendingChatMessage
{
	// Reuses the send idempotency key for reconciliation with canonical history.
	readonly id: string;
	// Captured submitted text independent of the cleared composer.
	readonly content: string;
	// Local send outcome, including a failure before main accepted the message.
	readonly status: "pending" | "failed";
}

// Renderer-owned session state for one reusable conversation surface.
export class ChatStore
{
	// Local submission awaiting reconciliation with canonical history.
	private pending: PendingChatMessage | null = null;
	// Exposes the transient submission without changing the persisted transcript.
	public get Pending(): PendingChatMessage | null
	{
		return this.pending;
	}
	// Records acceptance, failure, or completion of the local submission.
	public set Pending(value: PendingChatMessage | null)
	{
		this.pending = value;
	}

	// Canonical history last acknowledged by main.
	private snapshot: ChatConversationSnapshot | null = null;

	// Exposes the current session value through its owning store.
	public get Snapshot(): ChatConversationSnapshot | null
	{
		return this.snapshot;
	}

	// Applies a session transition without exposing mutable backing fields.
	public set Snapshot(value: ChatConversationSnapshot | null)
	{
		this.snapshot = value;
	}

	// Reader draft retained until a send succeeds.
	private draft: string = "";

	// Exposes the current session value through its owning store.
	public get Draft(): string
	{
		return this.draft;
	}

	// Applies a session transition without exposing mutable backing fields.
	public set Draft(value: string)
	{
		this.draft = value;
	}

	// Choice for the next response, independent of earlier message metadata.
	private model: ModelSelection | null = null;

	// Exposes the current session value through its owning store.
	public get Model(): ModelSelection | null
	{
		return this.model;
	}

	// Applies a session transition without exposing mutable backing fields.
	public set Model(value: ModelSelection | null)
	{
		this.model = value;
	}

	// Prevents overlapping sends from this surface.
	private busy: boolean = false;

	// Exposes the current session value through its owning store.
	public get Busy(): boolean
	{
		return this.busy;
	}

	// Applies a session transition without exposing mutable backing fields.
	public set Busy(value: boolean)
	{
		this.busy = value;
	}

	// Retains one idempotency identity across explicit retries of the same draft.
	private requestId: string | null = null;

	// Exposes the current session value through its owning store.
	public get RequestId(): string | null
	{
		return this.requestId;
	}

	// Applies a session transition without exposing mutable backing fields.
	public set RequestId(value: string | null)
	{
		this.requestId = value;
	}

	// Content belonging to the request identity.
	private requestContent: string = "";

	// Exposes the current session value through its owning store.
	public get RequestContent(): string
	{
		return this.requestContent;
	}

	// Applies a session transition without exposing mutable backing fields.
	public set RequestContent(value: string)
	{
		this.requestContent = value;
	}

}
