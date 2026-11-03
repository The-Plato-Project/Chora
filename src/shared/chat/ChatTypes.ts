// Historical provider metadata retained only so old conversations can survive Dream Trash operations.
export interface HistoricalModelSelection
{
	readonly provider: string;
	readonly model: string;
}

// Historical token accounting retained without an active model-provider dependency.
export interface HistoricalModelUsage
{
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly totalTokens?: number;
}

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
	readonly model: HistoricalModelSelection | null;
	// Provider token accounting when available.
	readonly usage: HistoricalModelUsage | null;
}

// Canonical conversation projection returned after persistence.
export interface ChatConversationSnapshot
{
	// Main-assigned conversation identity.
	readonly id: string;
	// Feature context owning the conversation lifecycle.
	readonly scope: ChatScope;
	// Model choice applied to subsequent turns.
	readonly model: HistoricalModelSelection;
	// Authoritative ordered transcript.
	readonly messages: readonly ChatMessage[];
	// Historical reading material keyed by message context identity.
	readonly contexts: readonly ChatContextSnapshot[];
}
