// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SplitViewControl } from "../../src/renderer/ui/controls/SplitViewControl.js";
import { StatusBarControl } from "../../src/renderer/ui/controls/StatusBarControl.js";

describe("Collapsed Explorer styles", function CollapsedExplorerStyleTests()
{
	it("keeps collapsed panels recoverable through shared row and column dividers", function ShowsRecoveryRail(): void
	{
		const shellPath = resolve(process.cwd(), "src", "renderer", "workspace", "WorkspaceShellPanel.ts");
		const stylesheetPath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const shell = readFileSync(shellPath, "utf8");
		const css = readFileSync(stylesheetPath, "utf8");

		expect(shell).toMatch(/class="workspace-activity-rail"[^>]*data-sidebar-rail/);
		expect(css).toMatch(/\.workspace-activity-rail\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
		expect(css).toMatch(/\.workspace-activity-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
		const view = new SplitViewControl({ Direction: "columns" });
		vi.spyOn(view.Root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 500));
		const explorer = document.createElement("button");
		const activated = vi.fn();
		explorer.addEventListener("click", activated);
		view.AddPane({ Id: "explorer", Label: "Explorer", Content: explorer, Size: 220 });
		view.AddPane({ Id: "vision", Label: "Vision", Content: document.createElement("div"), Size: 460 });
		view.AddPane({ Id: "text", Label: "Text", Content: document.createElement("div"), Fill: true });
		document.body.append(view.Root);
		const first = view.Root.querySelector<HTMLElement>('[data-split-before="explorer"]')!;
		first.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 4, button: 0, clientX: 220, bubbles: true }));
		window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 4, clientX: 0 }));
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4 }));
		expect(view.GetState().explorer.Collapsed).toBe(true);
		expect(explorer.parentElement?.style.flexBasis).toBe("0px");
		expect(explorer.parentElement?.inert).toBe(true);
		expect(first.isConnected).toBe(true);
		first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(view.GetState().explorer).toEqual({ Size: 220, Collapsed: false });
		expect(view.Root.querySelector('[data-split-pane="explorer"] > button')).toBe(explorer);
		explorer.click();
		expect(activated).toHaveBeenCalledTimes(1);
		const middle = view.Root.querySelector<HTMLElement>('[data-split-before="vision"]')!;
		middle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, button: 0, clientX: 680, bubbles: true }));
		window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 5, clientX: 268 }));
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5 }));
		expect(view.GetState().vision.Size).toBe(48);
		middle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
		expect(view.GetState().text.Collapsed).toBe(true);
		middle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		expect(view.GetState().text.Collapsed).toBe(false);
		const original = view.GetState();
		middle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 6, button: 0, clientX: 200, bubbles: true }));
		window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 6, clientX: 0 }));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(view.GetState()).toEqual(original);
		view.RemovePane("vision");
		expect(view.Root.querySelectorAll(":scope > .split-divider")).toHaveLength(1);
		view.Dispose();
		view.Root.remove();

		const rows = new SplitViewControl({ Direction: "rows" });
		vi.spyOn(rows.Root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 800));
		rows.AddPane({ Id: "workspace", Label: "Workspace", Content: document.createElement("div"), Size: 500, Fill: true });
		rows.AddPane({ Id: "words", Label: "Words", Content: document.createElement("div"), Size: 220 });
		const status = new StatusBarControl();
		document.body.append(rows.Root, status.Root);
		const horizontal = rows.Root.querySelector<HTMLElement>(".split-divider")!;
		horizontal.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
		expect(rows.GetState().words.Collapsed).toBe(true);
		expect(rows.Root.querySelector<HTMLElement>('[data-split-pane="words"]')?.style.flexBasis).toBe("0px");
		horizontal.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(rows.GetState().words).toEqual({ Size: 220, Collapsed: false });
		expect(status.Root.textContent).toBe("");
		expect(status.Root.parentElement).toBe(document.body);
		rows.Dispose();
		rows.Root.remove();
		status.Dispose();
		vi.restoreAllMocks();
	});
});
