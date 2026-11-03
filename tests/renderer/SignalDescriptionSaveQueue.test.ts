import { describe, expect, it, vi } from "vitest";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";
import { SignalDescriptionSaveQueue } from "../../src/renderer/signals/SignalDescriptionSaveQueue.js";

// Creates one canonical Signal response for queue behavior tests.
function CreateSignal(description: string): SignalRecord
{
	return {
		id: "signal-1",
		dreamId: "dream-1",
		workId: "republic",
		selections: [{
			dialogue: "republic", text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus: "s1", offset: 0 },
			end: { stephanus: "s1", offset: 3 },
			selectedText: "abc",
			locatorStart: null,
			locatorEnd: null
		}],
		text: "abc",
		description,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};
}

describe("SignalDescriptionSaveQueue", function SignalDescriptionSaveQueueTests()
{
	it("serializes writes and never applies a response superseded while in flight", async function SuppressesStaleResponseAsync(): Promise<void>
	{
		const queue = new SignalDescriptionSaveQueue();
		const applied: SignalRecord[] = [];
		const report = vi.fn();
		let completeFirst: ((signal: SignalRecord) => void) | null = null;
		let completeSecond: ((signal: SignalRecord) => void) | null = null;
		const firstSave = new Promise<SignalRecord>(function CaptureFirst(resolve): void
		{
			completeFirst = resolve;
		});
		const secondSave = new Promise<SignalRecord>(function CaptureSecond(resolve): void
		{
			completeSecond = resolve;
		});

		async function ApplyAsync(saved: SignalRecord): Promise<void>
		{
			applied.push(saved);
			await Promise.resolve();
		}

		function SaveFirstAsync(): Promise<SignalRecord>
		{
			return firstSave;
		}

		function SaveSecondAsync(): Promise<SignalRecord>
		{
			return secondSave;
		}

		const first = queue.RequestAsync("signal-1", "First", SaveFirstAsync, ApplyAsync, report);
		const second = queue.RequestAsync("signal-1", "Second", SaveSecondAsync, ApplyAsync, report);
		completeFirst?.(CreateSignal("First"));
		await first;
		expect(applied).toEqual([]);
		completeSecond?.(CreateSignal("Second"));
		await second;
		expect(applied.map(function GetDescription(signal): string
		{
			return signal.description;
		})).toEqual(["Second"]);
		expect(report).not.toHaveBeenCalled();
	});
});
