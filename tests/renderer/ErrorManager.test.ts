// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents, ErrorRecord } from "../../src/renderer/core/events/ChoraEvents.js";

afterEach(function RestoreMocks(): void
{
	vi.restoreAllMocks();
});

describe("ErrorManager", function ErrorManagerTests()
{
	it("formats, records, logs, and publishes errors consistently", async function ReportsError()
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const manager = new ErrorManager(events);
		let published: ErrorRecord | null = null;
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		events.Subscribe("error.reported", (record) =>
		{
			published = record;
		});

		manager.Report("ModelProvider", new Error("Network unavailable"), "Model request failed.");
		await Promise.resolve();

		expect(manager.GetRecords()).toHaveLength(1);
		expect(published).toMatchObject({ level: "error", source: "ModelProvider", message: "Network unavailable", userMessage: "Model request failed." });
		expect(console.error).toHaveBeenCalledWith("[Chora][ERROR][ModelProvider]", "Network unavailable", expect.objectContaining({ name: "Error", message: "Network unavailable" }));
	});

	it("returns a snapshot that cannot mutate stored diagnostics", function ProtectsStoredRecords()
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const manager = new ErrorManager(events);
		let publishedErrors = 0;
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		events.Subscribe("error.reported", () =>
		{
			publishedErrors += 1;
		});
		manager.Info("Application", "Started");
		const snapshot = manager.GetRecords() as ErrorRecord[];
		snapshot.length = 0;

		expect(manager.GetRecords()).toHaveLength(1);
		expect(publishedErrors).toBe(0);
	});
});
