import { randomUUID } from "node:crypto";
import type { DeleteSignalCommand, SaveSignalCommand, SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { LibraryService } from "../library/LibraryService.js";
import { Signal } from "./Signal.js";
import { SignalRepository } from "./SignalRepository.js";

// Removes one Signal identity from an authoritative document store.
export interface SignalAssociationRemover
{
	RemoveSignalEverywhereAsync(signalId: string): Promise<void>;
}

// Owns the authoritative collection of work-owned Signals.
export class SignalLibrary
{
	// Contains canonical Signal aggregates keyed by identity.
	private readonly signals = new Map<string, Signal>();
	// Tracks whether persistence has been loaded for this application run.
	private isLoaded = false;
	// Removes Signal associations from all owning document types.
	private associationRemovers: readonly SignalAssociationRemover[] = [];

	public constructor(
		private readonly repository: SignalRepository,
		private readonly documents: LibraryService)
	{
	}

	// Registers the authoritative document stores that may reference Signals.
	public SetAssociationRemovers(removers: readonly SignalAssociationRemover[]): void
	{
		this.associationRemovers = [...removers];
	}

	// Lists Signals belonging to one work.
	public async ListAsync(workId: string): Promise<SignalRecord[]>
	{
		await this.EnsureLoadedAsync();
		const records: SignalRecord[] = [];

		for (const signal of this.signals.values())
		{
			const record = signal.ToRecord();
			if (record.workId === workId) records.push(record);
		}

		return records;
	}

	// Creates or updates one Signal.
	public async SaveAsync(command: SaveSignalCommand): Promise<SignalRecord>
	{
		await this.EnsureLoadedAsync();
		const timestamp = new Date().toISOString();
		const document = await this.documents.GetAsync(command.workId);
		const existing = command.signalId === null ? undefined : this.signals.get(command.signalId);
		const signal = existing === undefined
			? Signal.Create(command, command.signalId ?? randomUUID(), timestamp, document)
			: existing.Update(command, timestamp, document);
		const record = signal.ToRecord();
		await this.repository.SaveAsync(record);
		this.signals.set(record.id, signal);

		return record;
	}

	// Deletes a Signal only after its final persisted association is gone.
	public async DeleteIfOrphanedAsync(signalId: string): Promise<void>
	{
		await this.EnsureLoadedAsync();
		const signal = this.signals.get(signalId);

		if (signal !== undefined)
		{
			const associated = await this.repository.IsAssociatedAsync(signalId);

			if (!associated)
			{
				const record = signal.ToRecord();
				await this.repository.DeleteAsync(record);
				this.signals.delete(signalId);
			}
		}
	}

	// Removes a Signal from every owning document and deletes its canonical record.
	public async DeleteEverywhereAsync(command: DeleteSignalCommand): Promise<void>
	{
		await this.EnsureLoadedAsync();
		const signal = this.signals.get(command.signalId);

		if (signal === undefined)
		{
			throw new Error(`Signal does not exist: ${command.signalId}`);
		}
		if (signal.ToRecord().workId !== command.workId)
		{
			throw new Error("Signal does not belong to the requested work");
		}
		if (this.associationRemovers.length === 0)
		{
			throw new Error("Signal association stores are unavailable");
		}

		for (const remover of this.associationRemovers)
		{
			await remover.RemoveSignalEverywhereAsync(command.signalId);
		}

		const record = signal.ToRecord();
		await this.repository.DeleteAsync(record);
		this.signals.delete(command.signalId);
	}

	// Loads and validates canonical Signal records once.
	private async EnsureLoadedAsync(): Promise<void>
	{
		if (!this.isLoaded)
		{
			const records = await this.repository.LoadAsync();

			for (const record of records)
			{
				if (!this.signals.has(record.id))
				{
					const document = await this.documents.GetAsync(record.workId);
					this.signals.set(record.id, new Signal(record, document));
				}
			}

			this.isLoaded = true;
		}
	}
}
