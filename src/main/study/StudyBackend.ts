import type { StudyUpdate } from "../../shared/study/StudyTypes.js";

// Application-owned execution boundary; evidence and UI never depend on Goose types.
export interface StudyBackend
{
	// Opens execution with an explicit model and revocable evidence endpoint.
	OpenAsync(model: string, tools: StudyToolEndpoint, publish: (update: Omit<StudyUpdate, "conversationId">) => void): Promise<void>;
	// Completes only after the backend reports a completed turn.
	PromptAsync(text: string): Promise<void>;
	// Requests cooperative cancellation before disposal terminates the process.
	CancelAsync(): Promise<void>;
	// Releases all process and transport capabilities synchronously.
	Dispose(): void;
}

// Revocable loopback tool capability shared only with the selected backend.
export interface StudyToolEndpoint
{
	// OS-assigned loopback location for one conversation only.
	readonly url: string;
	// Random bearer capability never exposed to the renderer.
	readonly token: string;
	// Exact effective tool names the adapter must verify.
	readonly names: readonly string[];
}
