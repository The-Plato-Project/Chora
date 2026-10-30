import type { ChatContextSnapshot } from "../../shared/chat/ChatTypes.js";

// Feature integration captures canonical material without retaining its lifecycle lease.
export interface ChatContextSource
{
	// Returns an immutable context after releasing the owning feature record.
	CaptureAsync(id: string, selection: unknown): Promise<ChatContextSnapshot>;
}
