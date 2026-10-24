import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { HasSignalSelection } from "../../shared/signals/SignalSelection.js";

// Owns renderer-side work-owned Signal records.
export class SignalStore
{
	// Contains authoritative Signal snapshots for the active work.
	private signals: readonly SignalRecord[] = [];

	// Replaces Signals for the active work.
	public SetWork(_workId: string, signals: readonly SignalRecord[]): void
	{
		this.signals = structuredClone(signals);
	}

	// Returns every Signal in the active work.
	public GetSignals(): readonly SignalRecord[]
	{
		return structuredClone(this.signals);
	}

	// Finds one Signal by stable identity.
	public GetSignal(signalId: string): SignalRecord | null
	{
		let signal: SignalRecord | null = null;

		for (const candidate of this.signals)
		{
			if (candidate.id === signalId) signal = candidate;
		}

		return signal === null ? null : structuredClone(signal);
	}

	// Finds existing Signals anchored to exactly the submitted selection.
	public FindMatching(selection: TextSelection): readonly SignalRecord[]
	{
		const matches: SignalRecord[] = [];

		for (const signal of this.signals)
		{
			const isMatch = HasSignalSelection(signal, selection);
			if (isMatch) matches.push(signal);
		}

		return structuredClone(matches);
	}

	// Inserts or replaces one authoritative Signal.
	public Replace(signal: SignalRecord): void
	{
		const records: SignalRecord[] = [];
		let replaced = false;

		for (const candidate of this.signals)
		{
			if (candidate.id === signal.id)
			{
				records.push(structuredClone(signal));
				replaced = true;
			}
			else
			{
				records.push(structuredClone(candidate));
			}
		}

		if (!replaced) records.push(structuredClone(signal));
		this.signals = records;
	}

	// Removes one authoritative Signal snapshot.
	public Remove(signalId: string): void
	{
		this.signals = this.signals.filter(function KeepSignal(signal): boolean
		{
			return signal.id !== signalId;
		});
	}
}
