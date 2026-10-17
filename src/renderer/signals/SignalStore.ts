import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";

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
			const isMatch = signal.selection.documentId === selection.documentId
				&& signal.selection.start.segmentKey === selection.start.segmentKey
				&& signal.selection.start.offset === selection.start.offset
				&& signal.selection.end.segmentKey === selection.end.segmentKey
				&& signal.selection.end.offset === selection.end.offset;
			if (isMatch) matches.push(signal);
		}

		return structuredClone(matches);
	}

	// Inserts or replaces one authoritative Signal.
	public Replace(signal: SignalRecord): void
	{
		const records: SignalRecord[] = [];

		for (const candidate of this.signals)
		{
			if (candidate.id !== signal.id) records.push(structuredClone(candidate));
		}
		records.push(structuredClone(signal));
		this.signals = records;
	}

}
