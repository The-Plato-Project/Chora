import fs from "node:fs/promises";
import path from "node:path";
import type { StudyConversation } from "../../shared/study/StudyTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";

// Persists the latest inspectable transcript separately from reader-authored documents.
export class StudyConversationRepository
{
	// Retired sessions cannot overwrite the latest conversation after cancellation.
	private currentId: string | null = null;
	// All atomic replacements share one queue and one owner.
	private pending = Promise.resolve();
	// The composition root supplies an internal application-data path, never a renderer path.
	public constructor(private readonly directory: string)
	{
	}

	// Selects the successfully opened conversation as the sole latest-history writer.
	public Activate(id: string): void
	{
		this.currentId = id;
	}

	// Replaces one transcript atomically; partial output remains explicitly partial.
	public SaveAsync(conversation: StudyConversation): Promise<void>
	{
		const repository = this;
		const serialized = JSON.stringify(conversation, null, 2);
		async function WriteAsync(): Promise<void>
		{
			if (repository.currentId === conversation.id) await repository.WriteAsync(serialized);
		}
		function Settled(): void
		{
		}
		const result = this.pending.then(WriteAsync, WriteAsync);
		this.pending = result.then(Settled, Settled);
		return result;
	}

	// Bounds the stored representation before replacing the previous readable history.
	private async WriteAsync(serialized: string): Promise<void>
	{
		if (Buffer.byteLength(serialized, "utf8") > 1048576) throw new Error("The conversation exceeds the saved-history limit. Its current transcript remains visible.");
		await fs.mkdir(this.directory, { recursive: true });
		const destination = path.join(this.directory, "latest.json");
		const temporary = path.join(this.directory, "latest.pending");
		await fs.writeFile(temporary, serialized, "utf8");
		await fs.rename(temporary, destination);
	}

	// Restores display history only; no runtime session or uncertain turn is replayed.
	public async LoadAsync(): Promise<StudyConversation | null>
	{
		let conversation: StudyConversation | null = null;
		try
		{
			const file = path.join(this.directory, "latest.json");
			const stat = await fs.stat(file);
			if (stat.size > 1048576) throw new Error("The saved conversation exceeds its size limit.");
			const text = await fs.readFile(file, "utf8");
			const value: unknown = JSON.parse(text);
			if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string"
				|| !("messages" in value) || !Array.isArray(value.messages) || value.messages.length > 100
				|| !("model" in value) || typeof value.model !== "string") throw new Error("The saved conversation is invalid.");
			for (const message of value.messages)
			{
				if (typeof message !== "object" || message === null || !["reader", "interlocutor"].includes(message.role)
					|| typeof message.text !== "string" || !["complete", "partial"].includes(message.status)) throw new Error("The saved contribution is invalid.");
			}
			if (!("scope" in value) || typeof value.scope !== "object" || value.scope === null || !("workId" in value.scope)
				|| typeof value.scope.workId !== "string" || !("visionIds" in value.scope) || !Array.isArray(value.scope.visionIds)
				|| value.scope.visionIds.length > 30 || !("selection" in value.scope)) throw new Error("The saved conversation scope is invalid.");
			for (const id of value.scope.visionIds)
			{
				if (typeof id !== "string" || id.length > 100) throw new Error("The saved Vision identity is invalid.");
			}
			if (value.scope.selection !== null) DecodeTextSelection(value.scope.selection);
			if (!("sources" in value) || !Array.isArray(value.sources) || value.sources.length > 100) throw new Error("The saved source list is invalid.");
			for (const source of value.sources)
			{
				if (typeof source !== "object" || source === null || typeof source.label !== "string" || typeof source.excerpt !== "string"
					|| (source.visionId !== null && typeof source.visionId !== "string")) throw new Error("The saved source is invalid.");
				if (source.selection !== null) DecodeTextSelection(source.selection);
			}
			conversation = value as StudyConversation;
		}
		catch (error)
		{
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		return conversation;
	}
}
