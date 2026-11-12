import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { StudyConversation } from "../../shared/study/StudyTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";

// Persists one conversation per canonical work independently of reader documents.
export class StudyConversationRepository
{
	// Atomic writes are serialized so cancellation cannot race a history replacement.
	private pending = Promise.resolve();

	// Only the host supplies this application-data directory.
	public constructor(private readonly directory: string)
	{
	}

	// Saves a captured work transcript without overwriting another work's history.
	public SaveAsync(conversation: StudyConversation): Promise<void>
	{
		const repository = this;
		const serialized = JSON.stringify(conversation, null, 2);
		const workId = conversation.scope.workId;
		async function WriteAsync(): Promise<void>
		{
			await repository.WriteAsync(workId, serialized);
		}
		function Settled(): void
		{
		}
		const result = this.pending.then(WriteAsync, WriteAsync);
		this.pending = result.then(Settled, Settled);
		return result;
	}

	// Restores passive history and migrates the earlier single-work checkpoint once.
	public async LoadAsync(workId: string): Promise<StudyConversation | null>
	{
		await this.pending;
		const destination = this.FilePath(workId);
		let value = await this.ReadAsync(destination);
		let legacy = false;
		if (value === null)
		{
			value = await this.ReadAsync(path.join(this.directory, "latest.json"));
			legacy = value !== null;
		}
		let conversation: StudyConversation | null = null;
		if (value !== null)
		{
			const decoded = this.Decode(value);
			if (decoded.scope.workId === workId)
			{
				conversation = decoded;
				if (legacy)
				{
					await this.SaveAsync(decoded);
					await fs.unlink(path.join(this.directory, "latest.json"));
				}
			}
		}
		return conversation;
	}

	// Stable hashes keep renderer-supplied identifiers out of filesystem paths.
	private FilePath(workId: string): string
	{
		const hash = createHash("sha256");
		hash.update(workId);
		const name = hash.digest("hex") + ".json";
		const destination = path.join(this.directory, name);
		return destination;
	}

	// Checks size before atomic replacement of the same work's history.
	private async WriteAsync(workId: string, serialized: string): Promise<void>
	{
		if (Buffer.byteLength(serialized, "utf8") > 1048576) throw new Error("This conversation exceeds the saved-history limit.");
		await fs.mkdir(this.directory, { recursive: true });
		const destination = this.FilePath(workId);
		const temporary = destination + ".pending";
		await fs.writeFile(temporary, serialized, "utf8");
		await fs.rename(temporary, destination);
	}

	// Missing history is ordinary; corrupt history remains an explicitly reported failure.
	private async ReadAsync(file: string): Promise<unknown>
	{
		let value: unknown = null;
		try
		{
			const stat = await fs.stat(file);
			if (stat.size > 1048576) throw new Error("The saved conversation exceeds its size limit.");
			const text = await fs.readFile(file, "utf8");
			value = JSON.parse(text);
		}
		catch (error)
		{
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		return value;
	}

	// Validates display history without granting any saved selection or attachment new authority.
	private Decode(value: unknown): StudyConversation
	{
		if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string"
			|| !("messages" in value) || !Array.isArray(value.messages) || value.messages.length > 100
			|| !("model" in value) || typeof value.model !== "string"
			|| !("scope" in value) || typeof value.scope !== "object" || value.scope === null
			|| !("workId" in value.scope) || typeof value.scope.workId !== "string"
			|| !("sources" in value) || !Array.isArray(value.sources) || value.sources.length > 100) throw new Error("The saved conversation is invalid.");
		for (const message of value.messages)
		{
			if (typeof message !== "object" || message === null || !["reader", "interlocutor"].includes(message.role)
				|| typeof message.text !== "string" || !["complete", "partial"].includes(message.status)) throw new Error("The saved contribution is invalid.");
		}
		for (const source of value.sources)
		{
			if (typeof source !== "object" || source === null || typeof source.label !== "string" || typeof source.excerpt !== "string") throw new Error("The saved source is invalid.");
			if (source.selection !== null) DecodeTextSelection(source.selection);
		}
		const conversation: StudyConversation = { id: value.id, scope: { workId: value.scope.workId }, model: value.model, messages: value.messages, sources: value.sources };
		return conversation;
	}
}
