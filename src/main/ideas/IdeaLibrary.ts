import { randomUUID } from "node:crypto";
import type { DeleteIdeaCommand, IdeaRecord, IdeaSignalReference, SaveIdeaCommand } from "../../shared/ideas/IdeaTypes.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { Idea } from "./Idea.js";
import { IdeaRepository } from "./IdeaRepository.js";

// Provides authoritative work-owned Signals used to validate Idea associations.
export interface IdeaSignalAccess
{
	ListAsync(workId: string): Promise<SignalRecord[]>;
	DeleteIfOrphanedAsync(signalId: string): Promise<void>;
}

// Owns durable Ideas, canonical identities, and Signal association validation.
export class IdeaLibrary
{
	// Aggregates keyed by main-owned Idea identity.
	private readonly ideas = new Map<string, Idea>();
	// Tracks whether persisted Ideas have been loaded for this application run.
	private isLoaded = false;

	// Creates the authoritative Idea library and its required collaborators.
	public constructor(
		private readonly repository: IdeaRepository,
		private readonly signals: IdeaSignalAccess)
	{
	}

	// Lists immutable Idea records belonging to one work.
	public async ListAsync(workId: string): Promise<IdeaRecord[]>
	{
		await this.EnsureLoadedAsync();
		const records: IdeaRecord[] = [];

		for (const idea of this.ideas.values())
		{
			const ownsIdea = idea.GetWorkId() === workId;

			if (ownsIdea)
			{
				const record = idea.ToRecord();
				records.push(record);
			}
		}

		return records;
	}

	// Creates or updates an Idea after resolving every submitted Signal.
	public async SaveAsync(command: SaveIdeaCommand): Promise<IdeaRecord>
	{
		await this.EnsureLoadedAsync();
		const previous = command.ideaId === null ? null : this.ideas.get(command.ideaId)?.ToRecord() ?? null;
		const originSignal = command.originSignal === null
			? null
			: await this.ResolveReferenceAsync(command.workId, command.originSignal);
		const relatedSignals = await this.ResolveReferencesAsync(command.workId, command.relatedSignals);
		const normalizedCommand: SaveIdeaCommand = {
			...structuredClone(command),
			originSignal,
			relatedSignals
		};
		const now = new Date();
		const timestamp = now.toISOString();
		let idea: Idea;

		if (command.ideaId === null)
		{
			const ideaId = randomUUID();
			idea = Idea.Create(normalizedCommand, ideaId, timestamp);
		}
		else
		{
			const existing = this.ideas.get(command.ideaId);

			if (existing === undefined)
			{
				throw new Error(`Idea does not exist: ${command.ideaId}`);
			}

			idea = existing.Update(normalizedCommand, timestamp);
		}

		const record = idea.ToRecord();
		await this.repository.SaveAsync(record);
		const ideaId = idea.GetId();
		this.ideas.set(ideaId, idea);

		if (previous !== null)
		{
			const previousReferences = previous.originSignal === null
				? [...previous.relatedSignals]
				: [previous.originSignal, ...previous.relatedSignals];
			const currentReferences = record.originSignal === null
				? [...record.relatedSignals]
				: [record.originSignal, ...record.relatedSignals];
			const currentIds = new Set(currentReferences.map((reference) => reference.signalId));

			for (const reference of previousReferences)
			{
				if (!currentIds.has(reference.signalId)) await this.signals.DeleteIfOrphanedAsync(reference.signalId);
			}
		}

		return record;
	}

	// Deletes one Idea after proving work ownership.
	public async DeleteAsync(command: DeleteIdeaCommand): Promise<void>
	{
		await this.EnsureLoadedAsync();
		const idea = this.ideas.get(command.ideaId);

		if (idea === undefined)
		{
			throw new Error(`Idea does not exist: ${command.ideaId}`);
		}
		if (idea.GetWorkId() !== command.workId)
		{
			throw new Error("Idea does not belong to the requested work");
		}

		const record = idea.ToRecord();
		const references = record.originSignal === null
			? [...record.relatedSignals]
			: [record.originSignal, ...record.relatedSignals];
		await this.repository.DeleteAsync(command.ideaId);
		this.ideas.delete(command.ideaId);

		for (const reference of references) await this.signals.DeleteIfOrphanedAsync(reference.signalId);
	}

	// Removes one Signal association from every persisted Idea.
	public async RemoveSignalEverywhereAsync(signalId: string): Promise<void>
	{
		await this.EnsureLoadedAsync();

		for (const [ideaId, idea] of this.ideas)
		{
			const record = idea.ToRecord();
			const references = record.originSignal === null
				? [...record.relatedSignals]
				: [record.originSignal, ...record.relatedSignals];
			const remaining = references.filter(function KeepReference(reference): boolean
			{
				return reference.signalId !== signalId;
			});

			if (remaining.length !== references.length)
			{
				const command: SaveIdeaCommand = {
					ideaId,
					workId: record.workId,
					title: record.title,
					content: record.content,
					originSignal: remaining[0] ?? null,
					relatedSignals: remaining.slice(1)
				};
				const updated = idea.Update(command, new Date().toISOString());
				const updatedRecord = updated.ToRecord();
				await this.repository.SaveAsync(updatedRecord);
				this.ideas.set(ideaId, updated);
			}
		}
	}

	// Loads and validates persisted Idea aggregates once.
	private async EnsureLoadedAsync(): Promise<void>
	{
		if (!this.isLoaded)
		{
			const records = await this.repository.LoadAsync();

			for (const record of records)
			{
				const idea = new Idea(record);
				const ideaId = idea.GetId();
				const hasIdea = this.ideas.has(ideaId);

				if (!hasIdea)
				{
					this.ideas.set(ideaId, idea);
				}
			}

			this.isLoaded = true;
		}
	}

	// Resolves submitted references against authoritative same-work Signals.
	private async ResolveReferencesAsync(workId: string, references: readonly IdeaSignalReference[]): Promise<IdeaSignalReference[]>
	{
		const signals = await this.signals.ListAsync(workId);
		const resolved: IdeaSignalReference[] = [];
		const identities = new Set<string>();

		for (const reference of references)
		{
			const signalId = reference.signalId.trim();
			const hasSignal = signals.some((signal) => signal.id === signalId);

			if (!hasSignal)
			{
				throw new Error(`Idea Signal reference is unresolved: ${signalId}`);
			}

			const identity = this.CreateReferenceIdentity(signalId);
			const isKnown = identities.has(identity);

			if (!isKnown)
			{
				identities.add(identity);
				const resolvedReference: IdeaSignalReference = reference.rationale === undefined
					? { signalId }
					: { signalId, rationale: reference.rationale };
				resolved.push(resolvedReference);
			}
		}

		return resolved;
	}

	// Resolves one submitted Signal against the authoritative work-owned collection.
	private async ResolveReferenceAsync(workId: string, reference: IdeaSignalReference): Promise<IdeaSignalReference>
	{
		const references = await this.ResolveReferencesAsync(workId, [reference]);
		const resolved = references[0];

		if (resolved === undefined)
		{
			throw new Error("Idea Signal reference is unresolved");
		}

		return resolved;
	}

	// Creates the stable identity used to remove duplicate references.
	private CreateReferenceIdentity(signalId: string): string
	{
		const identity = `signal:${signalId}`;

		return identity;
	}
}
