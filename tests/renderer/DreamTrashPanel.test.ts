// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DreamTrashPanel } from "../../src/renderer/dreams/DreamTrashPanel.js";
import type { DreamTrashController } from "../../src/renderer/dreams/DreamTrashController.js";
import type { DreamTrashSnapshot } from "../../src/shared/dreams/DreamTrashTypes.js";

// Mounted panels disposed after every interaction test.
const panels: DreamTrashPanel[] = [];

// Retained aggregate used to exercise display and destructive confirmation.
const record: DreamTrashSnapshot = {
	id: "01234567-0123-4123-8123-012345678901", dreamId: "dream-1", workId: "republic",
	title: "<em>Descent</em>", deletedAt: "2026-10-28T12:00:00Z", signalCount: 2, restoring: false
};

// Flushes delegated async event handlers before inspecting rendered state.
async function FlushAsync(): Promise<void>
{
	await new Promise(function Wait(resolve): void { setTimeout(resolve, 0); });
}

// Clicks a visible Trash action through the DOM event boundary.
function Click(action: string): void
{
	const button = document.querySelector<HTMLButtonElement>(`.popup-overlay:not([hidden]) [data-trash-action="${action}"]`);
	expect(button).not.toBeNull();
	button!.click();
}

afterEach(function DisposePanels(): void
{
	for (const panel of panels.splice(0)) panel.Dispose();
	document.body.innerHTML = "";
});

describe("DreamTrashPanel", function TrashInteractionTests()
{
	it("shows retained Signals and requires confirmation before permanent removal", async function ConfirmsPurgeAsync(): Promise<void>
	{
		const execute = vi.fn().mockResolvedValue(true);
		const list = vi.fn().mockResolvedValue([record]);
		const panel = new DreamTrashPanel({ ListAsync: list, ExecuteAsync: execute } as unknown as DreamTrashController);
		panels.push(panel);
		await panel.OpenAsync(document.body);
		expect(document.body.textContent).toContain("2 Signals");
		expect(document.body.textContent).toContain("Nothing expires automatically");
		expect(document.querySelector("em")).toBeNull();
		Click("purge");
		expect(execute).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("This cannot be undone");
		expect(document.activeElement?.textContent).toBe("Cancel");
		Click("cancel");
		expect(execute).not.toHaveBeenCalled();
		Click("purge");
		list.mockResolvedValue([]);
		Click("confirm");
		await FlushAsync();
		expect(execute).toHaveBeenCalledExactlyOnceWith("purge", record.id);
		expect(document.body.textContent).toContain("Trash is empty");
	});

	it("confirms Empty trash separately and restores without a destructive confirmation", async function RoutesActionsAsync(): Promise<void>
	{
		const execute = vi.fn().mockResolvedValue(true);
		const panel = new DreamTrashPanel({ ListAsync: vi.fn().mockResolvedValue([record]), ExecuteAsync: execute } as unknown as DreamTrashController);
		panels.push(panel);
		await panel.OpenAsync(document.body);
		Click("empty");
		expect(execute).not.toHaveBeenCalled();
		Click("cancel");
		Click("restore");
		await FlushAsync();
		expect(execute).toHaveBeenCalledExactlyOnceWith("restore", record.id);
		Click("empty");
		Click("confirm");
		await FlushAsync();
		expect(execute).toHaveBeenLastCalledWith("empty", "");
	});

	it("offers retry guidance after failure and protects interrupted restores", async function HandlesFailureAsync(): Promise<void>
	{
		const execute = vi.fn().mockResolvedValue(false);
		const panel = new DreamTrashPanel({ ListAsync: vi.fn().mockResolvedValue([{ ...record, restoring: true }]), ExecuteAsync: execute } as unknown as DreamTrashController);
		panels.push(panel);
		await panel.OpenAsync(document.body);
		expect(document.querySelector<HTMLButtonElement>('[data-trash-action="purge"]')?.disabled).toBe(true);
		Click("restore");
		await FlushAsync();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not finish");
	});
});
