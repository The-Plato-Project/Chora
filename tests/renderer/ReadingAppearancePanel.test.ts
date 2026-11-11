// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ReadingSettingsStore } from "../../src/renderer/core/settings/ReadingSettingsStore.js";
import { ReadingAppearancePanel } from "../../src/renderer/workspace/ReadingAppearancePanel.js";
import { StudySettingsStore } from "../../src/renderer/study/StudySettingsStore.js";

afterEach(function Cleanup(): void
{
	window.localStorage.clear();
	document.body.replaceChildren();
	document.documentElement.style.removeProperty("--vision-reference-color");
});

describe("ReadingAppearancePanel", function ReadingAppearancePanelTests()
{
	it("uses the current anchor color by default and persists a reader-selected color", async function ChangesAnchorColor(): Promise<void>
	{
		const settings = new ReadingSettingsStore();
		const events = new ChoraEventBus<ChoraEvents>();
		const ApplyAsync = vi.fn().mockResolvedValue(undefined);
		const panel = new ReadingAppearancePanel(settings, events, new ErrorManager(events), { ApplyAsync });
		await events.PublishAsync("workspace.settings-open-requested", {});
		expect(ApplyAsync).toHaveBeenCalledWith("light");
		expect(document.querySelector(".control-window-header h2")?.textContent).toBe("Chora settings");

		expect(settings.GetAnchorHighlightColor()).toBe("#b65e3b");
		expect(document.documentElement.style.getPropertyValue("--vision-reference-color")).toBe("#b65e3b");

		const input = document.querySelector<HTMLInputElement>("[data-anchor-highlight-color]")!;
		document.querySelector<HTMLSelectElement>("[data-interlocutor-model]")!.value = "qwen3.5:4b";
		input.value = "#336699";
		input.dispatchEvent(new Event("change", { bubbles: true }));
		expect(settings.GetAnchorHighlightColor()).toBe("#b65e3b");
		document.querySelector<HTMLButtonElement>("[data-dialog-cancel]")!.click();
		await events.PublishAsync("workspace.settings-open-requested", {});
		expect(document.querySelector<HTMLSelectElement>("[data-interlocutor-model]")!.value).toBe("qwen3.5:9b");
		document.querySelector<HTMLSelectElement>("[data-interlocutor-model]")!.value = "qwen3.5:4b";
		expect(document.querySelector<HTMLInputElement>("[data-anchor-highlight-color]")!.value).toBe("#b65e3b");
		document.querySelector<HTMLInputElement>("[data-anchor-highlight-color]")!.value = "#336699";
		document.querySelector<HTMLSelectElement>("[data-appearance]")!.value = "dark";
		document.querySelector<HTMLButtonElement>("[data-dialog-ok]")!.click();
		await vi.waitFor(function SettingsCommitted(): void
		{
			expect(settings.GetAnchorHighlightColor()).toBe("#336699");
		});

		expect(settings.GetAnchorHighlightColor()).toBe("#336699");
		expect(document.documentElement.style.getPropertyValue("--vision-reference-color")).toBe("#336699");
		expect(new ReadingSettingsStore().GetAnchorHighlightColor()).toBe("#336699");
		expect(new StudySettingsStore().GetModel()).toBe("qwen3.5:4b");
		expect(ApplyAsync).toHaveBeenLastCalledWith("dark");
		panel.Dispose();
	});

	it("rejects values that are not six-digit colors", function RejectsInvalidColor(): void
	{
		const settings = new ReadingSettingsStore();
		expect(() => settings.SetAnchorHighlightColor("red")).toThrow("anchor highlight color is invalid");
	});
});
