import type { TextSelection } from "../text/TextSelection.js";

// Reader-approved evidence scope, captured once for a conversation.
export interface StudyScope
{
	// Canonical work whose text and linguistic material may be read.
	readonly workId: string;
	// Explicitly selected saved documents; an empty list shares no writing.
	readonly visionIds: readonly string[];
	// Optional exact passage attached by the reader at launch.
	readonly selection: TextSelection | null;
}

// One attributed contribution, retained independently of Vision prose.
export interface StudyMessage
{
	// Preserves authorship separately from the message content.
	readonly role: "reader" | "interlocutor";
	// Plain display text has no command or placement authority.
	readonly text: string;
	// Interrupted generation must never appear as a completed answer.
	readonly status: "complete" | "partial";
}

// Application-owned transcript, independent of a backend's native session ID.
export interface StudyConversation
{
	// Stable application identity independent of the execution backend.
	readonly id: string;
	// Captured grant, unaffected by later tab or passage selection changes.
	readonly scope: StudyScope;
	// Effective local model verified before the first submission.
	readonly model: string;
	// Ordered attributed contributions, including partial responses.
	readonly messages: readonly StudyMessage[];
	// Actual retrieved evidence rather than model-generated link claims.
	readonly sources: readonly StudySource[];
}

// A host-validated source card, distinct from citations the model may merely claim.
export interface StudySource
{
	// Human-readable citation, including the saved revision for writing.
	readonly label: string;
	// Bounded context for inspecting the retrieved source.
	readonly excerpt: string;
	// Optional document navigation target, resolved by the Vision owner.
	readonly visionId: string | null;
	// Optional canonical navigation target, validated by the text owner.
	readonly selection: TextSelection | null;
}

// Narrow streaming facts consumed only by the interlocutor feature.
export interface StudyUpdate
{
	// Allows the renderer to discard updates from retired conversations.
	readonly conversationId: string;
	// Separates visible response text from transient retrieval activity.
	readonly kind: "text" | "tool";
	// Bounded content; provider secrets and raw diagnostics are excluded.
	readonly text: string;
}

// Explicitly selected local execution configuration; never a hosted-provider fallback.
export interface StudyStartCommand
{
	// Reader-selected evidence grant, validated in the main process.
	readonly scope: StudyScope;
	// Deliberate local choice; no provider or model fallback is permitted.
	readonly model: "qwen3.5:9b" | "qwen3.5:4b";
}
