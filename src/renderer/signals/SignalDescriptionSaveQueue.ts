import type { SignalRecord } from "../../shared/signals/SignalTypes.js";

// Describes one pending canonical Signal-description write.
interface SignalDescriptionWrite
{
	readonly description: string;
	readonly saveAsync: () => Promise<SignalRecord>;
	readonly applyAsync: (saved: SignalRecord) => Promise<void>;
	readonly report: (error: unknown) => void;
}

// Resolves one caller after its requested revision has finished writing.
interface SignalDescriptionWaiter
{
	readonly revision: number;
	readonly resolve: () => void;
}

// Tracks the newest requested write and the one serialized writer draining it.
interface SignalDescriptionSaveState
{
	revision: number;
	write: SignalDescriptionWrite;
	running: Promise<void> | null;
	readonly waiters: SignalDescriptionWaiter[];
}

// Serializes Signal-description writes and applies only the newest completed response.
export class SignalDescriptionSaveQueue
{
	private readonly states = new Map<string, SignalDescriptionSaveState>();

	// Records the newest description and resolves after its revision has been persisted or reported.
	public RequestAsync(
		signalId: string,
		description: string,
		saveAsync: () => Promise<SignalRecord>,
		applyAsync: (saved: SignalRecord) => Promise<void>,
		report: (error: unknown) => void): Promise<void>
	{
		let state = this.states.get(signalId);

		if (state === undefined)
		{
			state = {
				revision: 0,
				write: { description, saveAsync, applyAsync, report },
				running: null,
				waiters: []
			};
			this.states.set(signalId, state);
		}

		state.revision += 1;
		state.write = { description, saveAsync, applyAsync, report };
		const requestedRevision = state.revision;
		const completion = new Promise<void>(function StoreCompletion(resolve): void
		{
			state?.waiters.push({ revision: requestedRevision, resolve });
		});

		if (state.running === null)
		{
			state.running = this.DrainAsync(signalId, state);
		}

		return completion;
	}

	// Writes one revision at a time, skipping application of responses superseded while in flight.
	private async DrainAsync(signalId: string, state: SignalDescriptionSaveState): Promise<void>
	{
		let hasNewerWrite = true;

		while (hasNewerWrite)
		{
			const revision = state.revision;
			const write = state.write;

			try
			{
				const saved = await write.saveAsync();

				if (revision === state.revision)
				{
					await write.applyAsync(saved);
				}
			}
			catch (error)
			{
				write.report(error);
			}

			this.ResolveWaiters(state, revision);
			hasNewerWrite = state.revision > revision;
		}

		state.running = null;
		this.states.delete(signalId);
	}

	// Resolves callers whose requested write has completed without disturbing newer callers.
	private ResolveWaiters(state: SignalDescriptionSaveState, revision: number): void
	{
		const pending: SignalDescriptionWaiter[] = [];

		for (const waiter of state.waiters)
		{
			if (waiter.revision <= revision) waiter.resolve();
			else pending.push(waiter);
		}

		state.waiters.length = 0;
		state.waiters.push(...pending);
	}
}
