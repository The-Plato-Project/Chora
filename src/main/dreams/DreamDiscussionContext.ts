import { randomUUID } from "node:crypto";
import type { ChatContextSource } from "../chat/ChatContextSource.js";
import type { ChatContextSnapshot } from "../../shared/chat/ChatTypes.js";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { DreamMarkdownExport } from "../../shared/dreams/DreamMarkdownExport.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { DreamLibrary } from "./DreamLibrary.js";
import type { LibraryService } from "../library/LibraryService.js";

// Supplies Dream material to reusable Chat without accepting renderer-assembled reading documents.
export class DreamDiscussionContext implements ChatContextSource
{
	// Uses the same aggregate and text authorities as editing and persistence.
	public constructor(private readonly dreams: DreamLibrary, private readonly documents: LibraryService)
	{
	}

	// Captures exact material while holding the Dream lease only long enough to create the snapshot.
	public async CaptureAsync(id: string, selection: unknown): Promise<ChatContextSnapshot>
	{
		const self = this;
		async function CaptureSnapshotAsync(dream: DreamSnapshot): Promise<ChatContextSnapshot>
		{
			const document = await self.documents.GetAsync(dream.workId);
			let content = DreamMarkdownExport.Serialize(dream, document);
			if (selection !== null && selection !== undefined)
			{
				const range = DecodeTextSelection(selection);
				document.ValidateSelection(range);
				const text = document.ReconstructText(range);
				content += `\n\n## Reader's current selection\n${text}`;
			}
			if (content.length > 120000) throw ApplicationError.Expected("validation", "CHAT_CONTEXT_LIMIT", "This Dream is too large for a discussion request. Narrow its source or observations first.");
			const context: ChatContextSnapshot = { id: randomUUID(), scope: { kind: "dream", id }, revision: dream.updatedAt, content, capturedAt: new Date().toISOString() };
			return context;
		}
		const context = await this.dreams.WithSnapshotAsync(id, CaptureSnapshotAsync);
		return context;
	}
}
