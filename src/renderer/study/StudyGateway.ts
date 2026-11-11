import type { StudyConversation, StudySendCommand, StudyUpdate } from "../../shared/study/StudyTypes.js";
import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";

// Transports ordinary chat commands without exposing backend setup to the interface.
export class StudyGateway
{
	// Execution starts lazily on the first message for a work.
	public SendAsync(command: StudySendCommand): Promise<StudyConversation>
	{
		const result = ReadOperationAsync(window.chora.SendStudy(command));
		return result;
	}

	// Cancellation names its work so a stale command cannot stop another conversation.
	public StopAsync(workId: string): Promise<void>
	{
		const result = ReadOperationAsync(window.chora.StopStudy(workId));
		return result;
	}

	// Restores work-specific history without running the model.
	public LoadAsync(workId: string): Promise<StudyConversation | null>
	{
		const result = ReadOperationAsync(window.chora.LoadStudyHistory(workId));
		return result;
	}

	// Retains a single typed streaming subscription for the chat owner.
	public Subscribe(callback: (update: StudyUpdate) => void): () => void
	{
		const unsubscribe = window.chora.SubscribeStudy(callback);
		return unsubscribe;
	}
}
