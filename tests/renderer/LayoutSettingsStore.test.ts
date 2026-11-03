// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { LayoutSettingsStore } from "../../src/renderer/core/settings/LayoutSettingsStore.js";

afterEach(function Cleanup(): void
{
	window.localStorage.clear();
});

describe("LayoutSettingsStore", function LayoutSettingsStoreTests()
{
	it("restores durable dimensions and Explorer collapse state", function RestoresLayout(): void
	{
		const settings = new LayoutSettingsStore();
		settings.SetDimension("leftPaneWidth", 312);
		settings.SetDimension("dreamSourceHeight", 284);
		settings.SetDimension("wordPaneHeight", 336);
		settings.SetExplorerCollapsed(true);

		const restored = new LayoutSettingsStore();

		expect(restored.GetDimension("leftPaneWidth", 220)).toBe(312);
		expect(restored.GetDimension("dreamSourceHeight", 144)).toBe(284);
		expect(restored.GetDimension("wordPaneHeight", 220)).toBe(336);
		expect(restored.GetExplorerCollapsed()).toBe(true);
	});

	it("ignores corrupt and out-of-range persisted dimensions", function RejectsInvalidLayout(): void
	{
		window.localStorage.setItem("chora:layout-settings", JSON.stringify({
			dimensions: {
				leftPaneWidth: -10,
				editorPaneWidth: "wide",
				lookupHeight: 5000
			},
			explorerCollapsed: "yes"
		}));

		const restored = new LayoutSettingsStore();

		expect(restored.GetDimension("leftPaneWidth", 220)).toBe(220);
		expect(restored.GetDimension("editorPaneWidth", 500)).toBe(500);
		expect(restored.GetExplorerCollapsed()).toBe(false);
	});
});
