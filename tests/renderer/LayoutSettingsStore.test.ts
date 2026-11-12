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
		settings.SetDimension("editorPaneWidth", 584);
		settings.SetDimension("wordPaneHeight", 336);
		settings.SetDimension("wordDictionaryPrimaryRatio", 400);
		settings.SetDimension("wordOccurrenceNavigationRatio", 300);
		settings.SetExplorerCollapsed(true);
		settings.SetSplitView("workspace-columns", {
			explorer: { Size: 312, Collapsed: true },
			vision: { Size: 48, Collapsed: false }
		});

		const restored = new LayoutSettingsStore();

		expect(restored.GetDimension("leftPaneWidth", 220)).toBe(312);
		expect(restored.GetDimension("editorPaneWidth", 500)).toBe(584);
		expect(restored.GetDimension("wordPaneHeight", 220)).toBe(336);
		expect(restored.GetDimension("wordDictionaryPrimaryRatio", 0)).toBe(400);
		expect(restored.GetDimension("wordOccurrenceNavigationRatio", 0)).toBe(300);
		expect(restored.GetExplorerCollapsed()).toBe(true);
		expect(restored.GetSplitView("workspace-columns")).toEqual({
			explorer: { Size: 312, Collapsed: true },
			vision: { Size: 48, Collapsed: false }
		});
	});

	it("ignores corrupt and out-of-range persisted dimensions", function RejectsInvalidLayout(): void
	{
		window.localStorage.setItem("chora:layout-settings", JSON.stringify({
			dimensions: {
				leftPaneWidth: -10,
				editorPaneWidth: "wide",
				lookupHeight: 5000
			},
			explorerCollapsed: "yes",
			splitViews: { malformed: { negative: { Size: -1, Collapsed: false }, invalid: { Size: "wide", Collapsed: false } } }
		}));

		const restored = new LayoutSettingsStore();

		expect(restored.GetDimension("leftPaneWidth", 220)).toBe(220);
		expect(restored.GetDimension("editorPaneWidth", 500)).toBe(500);
		expect(restored.GetExplorerCollapsed()).toBe(false);
		expect(restored.GetSplitView("malformed")).toEqual({});
	});
});
