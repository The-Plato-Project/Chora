import type { StudyConversation, StudyStartCommand, StudyUpdate } from "../../shared/study/StudyTypes.js";
import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";

// Stateless typed bridge for optional interlocutor execution and history.
export class StudyGateway
{
	// Starts only the context explicitly chosen by the reader.
	public StartAsync(command: StudyStartCommand): Promise<StudyConversation>
	{
		const result = ReadOperationAsync(window.chora.StartStudy(command));
		return result;
	}
	// Sends one contribution to its captured conversation identity.
	public SendAsync(id: string, text: string): Promise<StudyConversation>
	{
		const result = ReadOperationAsync(window.chora.SendStudy(id, text));
		return result;
	}
	// Stops execution and revokes the evidence capability.
	public StopAsync(): Promise<void>
	{
		const result = ReadOperationAsync(window.chora.StopStudy());
		return result;
	}
	// Restores passive history without launching a model.
	public LoadAsync(): Promise<StudyConversation | null>
	{
		const result = ReadOperationAsync(window.chora.LoadStudyHistory());
		return result;
	}
	// Owns the single streaming subscription used by this feature.
	public Subscribe(callback: (update: StudyUpdate) => void): () => void
	{
		const unsubscribe = window.chora.SubscribeStudy(callback);
		return unsubscribe;
	}
}
