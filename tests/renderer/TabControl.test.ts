// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { TabControl } from "../../src/renderer/ui/controls/TabControl.js";
import { TabPanel } from "../../src/renderer/ui/controls/TabPanel.js";

// Minimal concrete content for exercising the base class contract.
class TestPanel extends TabPanel
{
	// Creates a persistent text editor.
	public constructor(id: string)
	{
		super(id, id);
		this.Root.innerHTML = "<textarea></textarea>";
	}
}

describe("TabControl", function TabControlTests()
{
	it("preserves nodes, editor values, and panel scroll through selection", function PreservesContent()
	{
		const first = new TestPanel("first");
		const second = new TestPanel("second");
		const tabs = new TabControl([first, second], "Test content");
		document.body.append(tabs.Root);
		const editor = first.Root.querySelector("textarea")!;
		editor.value = "Uncommitted text";
		first.Root.scrollTop = 120;
		tabs.Select("second");
		expect(first.Root.hidden).toBe(true);
		tabs.Select("first");
		expect(first.Root.querySelector("textarea")).toBe(editor);
		expect(editor.value).toBe("Uncommitted text");
		expect(first.Root.scrollTop).toBe(120);
		tabs.Dispose();
		expect(first.Root.isConnected).toBe(false);
	});

	it("supports keyboard activation and correctly linked accessibility roles", function SupportsKeyboard()
	{
		const tabs = new TabControl([new TestPanel("first"), new TestPanel("second")], "Test content");
		document.body.append(tabs.Root);
		const buttons = tabs.Root.querySelectorAll<HTMLButtonElement>("[role=tab]");
		buttons[0]!.focus();
		buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(document.activeElement).toBe(buttons[1]);
		expect(buttons[1]!.getAttribute("aria-selected")).toBe("true");
		expect(buttons[0]!.tabIndex).toBe(-1);
		expect(buttons[1]!.getAttribute("aria-controls")).toBe(tabs.Panels[1]!.Root.id);
		buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
		expect(document.activeElement).toBe(buttons[0]);
		buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
		expect(document.activeElement).toBe(buttons[1]);
		tabs.Dispose();
	});

	it("rejects duplicate panel identities", function RejectsDuplicateIds()
	{
		function CreateInvalidControl(): void
		{
			new TabControl([new TestPanel("same"), new TestPanel("same")], "Invalid");
		}
		expect(CreateInvalidControl).toThrow("unique");
	});

	it("adds and closes reusable dynamic tabs", function ManagesDynamicTabs()
	{
		const closed: string[] = [];
		const tabs = new TabControl([new TestPanel("first")], "Dynamic content", undefined, (id) => closed.push(id));
		document.body.append(tabs.Root);
		tabs.Add(new TestPanel("second"), true);
		tabs.Select("second");
		expect(tabs.GetSelectedId()).toBe("second");
		expect(tabs.Root.querySelectorAll("[role=tab]")).toHaveLength(2);
		tabs.Root.querySelector<HTMLButtonElement>('[data-tab-close="second"]')?.click();
		expect(closed).toEqual(["second"]);
		tabs.Remove("second");
		expect(tabs.GetSelectedId()).toBe("first");
		expect(tabs.Root.querySelectorAll("[role=tab]")).toHaveLength(1);
		tabs.Dispose();
	});
});
