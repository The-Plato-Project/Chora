import { describe, expect, it } from "vitest";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";

interface TestEvents
{
	"vision.opened": { visionId: string };
	"vision.closed": Record<string, never>;
}

describe("ChoraEventBus", function ChoraEventBusTests()
{
	it("publishes typed events to every subscriber and supports unsubscription", async function PublishesAndUnsubscribes()
	{
		const events = new ChoraEventBus<TestEvents>();
		const received: string[] = [];
		const unsubscribe = events.Subscribe("vision.opened", (event) =>
		{
			received.push(event.visionId);
		});

		await events.PublishAsync("vision.opened", { visionId: "vision-1" });
		unsubscribe();
		await events.PublishAsync("vision.opened", { visionId: "vision-2" });

		expect(received).toEqual(["vision-1"]);
	});

	it("continues delivery and reports a subscriber failure", async function IsolatesSubscriberFailures()
	{
		const events = new ChoraEventBus<TestEvents>();
		const received: string[] = [];
		const failures: string[] = [];
		events.SetErrorHandler((failure) =>
		{
			failures.push(String(failure.eventName));
		});
		events.Subscribe("vision.opened", () =>
		{
			throw new Error("Broken subscriber");
		});
		events.Subscribe("vision.opened", (event) =>
		{
			received.push(event.visionId);
		});

		await events.PublishAsync("vision.opened", { visionId: "vision-1" });

		expect(received).toEqual(["vision-1"]);
		expect(failures).toEqual(["vision.opened"]);
	});

	it("does not recurse when the failure reporter publishes another failing event", async function PreventsFailureRecursion()
	{
		const events = new ChoraEventBus<TestEvents>();
		let reports = 0;
		events.Subscribe("vision.closed", () =>
		{
			throw new Error("Failure reporter subscriber failed");
		});
		events.Subscribe("vision.opened", () =>
		{
			throw new Error("Original failure");
		});
		events.SetErrorHandler(async () =>
		{
			reports += 1;
			await events.PublishAsync("vision.closed", {});
		});

		await events.PublishAsync("vision.opened", { visionId: "vision-1" });

		expect(reports).toBe(1);
	});
});
