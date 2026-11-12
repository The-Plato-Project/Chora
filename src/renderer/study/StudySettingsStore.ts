import type { StudyModel } from "../../shared/study/StudyTypes.js";

// Owns the interlocutor's application-wide local-model preference.
export class StudySettingsStore
{
	// Model selection belongs in Chora settings rather than each conversation.
	private static readonly StorageKey = "chora:interlocutor-model";
	// Retains changes for this run even if preference storage is unavailable.
	private model: StudyModel = "qwen3.5:9b";

	// Loads the existing supported preference without starting any execution.
	public constructor()
	{
		try
		{
			const saved = window.localStorage.getItem(StudySettingsStore.StorageKey);
			if (saved === "qwen3.5:4b") this.model = saved;
		}
		catch { /* The default remains available when storage cannot be read. */ }
	}

	// Returns the preference captured for the next chat submission.
	public GetModel(): StudyModel
	{
		return this.model;
	}

	// Saves only the deliberate local choice; it never starts a model.
	public SetModel(model: StudyModel): void
	{
		this.model = model;
		try
		{
			window.localStorage.setItem(StudySettingsStore.StorageKey, model);
		}
		catch { /* The preference still applies to this application run. */ }
	}
}
