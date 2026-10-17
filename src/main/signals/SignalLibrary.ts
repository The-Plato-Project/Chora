import { randomUUID } from "node:crypto";
import type { SaveSignalCommand, SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { LibraryService } from "../library/LibraryService.js";
import { Signal } from "./Signal.js";
import { SignalRepository } from "./SignalRepository.js";

// Owns the authoritative collection of work-owned Signals.
export class SignalLibrary
{
	// Contains canonical Signal aggregates keyed by identity.
	private readonly signals = new Map<string, Signal>();
	// Tracks whether persistence has been loaded for this application run.
	private isLoaded = false;

	public constructor(
		private readonly repository: SignalRepository,
		private readonly documents: LibraryService)
	{
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

	// Imports legacy embedded Signals into the canonical Signal repository without overwriting existing records.
	public async ImportAsync(records: readonly SignalRecord[]): Promise<void>
	{
		await this.EnsureLoadedAsync();

		for (const record of records)
		{
			if (!this.signals.has(record.id))
			{
				const document = await this.documents.GetAsync(record.workId);
				const signal = new Signal(record, document);
				const canonical = signal.ToRecord();
				await this.repository.SaveAsync(canonical);
				this.signals.set(canonical.id, signal);
			}
		}
	}

	// Loads and validates canonical and migrated Signal records once.
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
