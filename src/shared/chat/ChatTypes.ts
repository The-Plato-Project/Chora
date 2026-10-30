import type { ModelSelection } from "../models/ModelSelection.js";
import type { ModelUsage } from "../models/ModelTypes.js";
import type { TextSelection } from "../text/TextSelection.js";

// Feature-owned identity; additional kinds require a registered main context owner.
export interface ChatScope
{
	// Initial supported discussion feature.
	readonly kind: "dream";
	// Canonical feature record identity, never a filesystem path.
	readonly id: string;
}

// Durable message lifecycle, including interrupted provider work.
export type ChatMessageStatus = "pending" | "streaming" | "completed" | "cancelled" | "failed" | "interrupted";

// Immutable material used for one specific model turn.
export interface ChatContextSnapshot
{
	// Main-assigned identity linking messages to their exact reading material.
	readonly id: string;
	// Feature record that supplied the material.
	readonly scope: ChatScope;
	// Canonical feature revision captured after the reader's save.
	readonly revision: string;
	// Exact model-facing context assembled by the main feature owner.
	readonly content: string;
	// Capture time independent of later feature edits.
	readonly capturedAt: string;
}

// Saved utterance; model output never overwrites reader-authored Dream prose.
export interface ChatMessage
{
	// Main-assigned stable message identity.
	readonly id: string;
	// Turn identity shared by a user message and its response attempts.
	readonly turnId: string;
	// Actual speaker rather than an imported legacy result.
	readonly role: "user" | "assistant";
	// Markdown text, including retained partial output.
	readonly content: string;
	// Explicit completion outcome.
	readonly status: ChatMessageStatus;
	// Exact context used by the response.
	readonly contextId: string;
	// Persisted creation time.
	readonly createdAt: string;
	// Actual model metadata on generated responses.
	readonly model: ModelSelection | null;
	// Provider token accounting when available.
	readonly usage: ModelUsage | null;
}

// Canonical conversation projection returned after persistence.
export interface ChatConversationSnapshot
{
	// Main-assigned conversation identity.
	readonly id: string;
	// Feature context owning the conversation lifecycle.
	readonly scope: ChatScope;
	// Model choice applied to subsequent turns.
	readonly model: ModelSelection;
	// Authoritative ordered transcript.
	readonly messages: readonly ChatMessage[];
	// Historical reading material keyed by message context identity.
	readonly contexts: readonly ChatContextSnapshot[];
}

// Narrow send command; main resolves prompts, history and canonical feature data.
export interface SendChatMessageCommand
{
	// Existing main-owned conversation identity.
	readonly conversationId: string;
	// Bounded client idempotency key; never used as a persistence path.
	readonly clientRequestId: string;
	// Selected transport/model for this turn; validated in the main process.
	readonly model: ModelSelection;
	// Reader's new message.
	readonly content: string;
	// Explicit optional reading selection, resolved against the canonical text.
	readonly selection: TextSelection | null;
}

// Ordered transient stream update; terminal state is read from persisted snapshots.
export interface ChatDelta
{
	// Conversation receiving the output.
	readonly conversationId: string;
	// Active response identity used to reject stale output.
	readonly turnId: string;
	// Monotonic ordering within the active response.
	readonly sequence: number;
	// Newly received text without fabricated token simulation.
	readonly text: string;
}
