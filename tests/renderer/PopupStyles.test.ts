// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DialogControl } from "../../src/renderer/ui/controls/DialogControl.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";

afterEach(function Cleanup(): void
{
	document.body.replaceChildren();
	document.head.replaceChildren();
});

describe("Popup styles", function PopupStyleTests()
{
	it("uses shared styling and commits only once through OK", async function UsesApplicationStylesAsync(): Promise<void>
	{
		const stylesheet = document.createElement("style");
		const base = readFileSync("src/renderer/styles/base.css", "utf8");
		const controls = readFileSync("src/renderer/styles/controls.css", "utf8");
		const menu = readFileSync("src/renderer/styles/menu-bar.css", "utf8");
		expect(menu).toMatch(/\.menu-bar-popup\s*\{[^}]*border-radius:\s*0;/s);
		expect(base).toMatch(/\.action-menu \.action-menu-items\s*\{[^}]*border-radius:\s*0;/s);
		expect(base).toMatch(/\.action-menu \.action-menu-items button\s*\{[^}]*border-radius:\s*0;/s);
		expect(controls).toMatch(/\.control-input:focus,[\s\S]*?border-color:\s*var\(--panel-border\);[\s\S]*?outline:\s*0;/);
		// Happy DOM caches computed pseudo-state styles; inspect the field rule as well as border stability.
		const fieldFocus = controls.match(/\.control-field :is\(input, select, textarea\):focus-visible\s*\{([^}]+)\}/s)?.[1];
		expect(fieldFocus).toContain("outline: 0;");
		expect(fieldFocus).toContain("box-shadow: none;");
		expect(readFileSync("src/renderer/library/DocumentPanel.ts", "utf8")).toContain('class="control-input" data-find-input');
		expect(readFileSync("src/renderer/library/words/WordSearchPanel.ts", "utf8")).toContain('this.input.className = "control-input"');
		stylesheet.textContent = `${base}\n${controls}`;
		document.head.append(stylesheet);
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const popup = new DialogControl(errors);
		let commits = 0;
		let finishCommit: (accepted: boolean) => void = function Ignore(): void {};
		async function CommitAsync(): Promise<boolean>
		{
			commits += 1;
			const accepted = await new Promise<boolean>(function WaitForCompletion(resolve): void
			{
				finishCommit = resolve;
			});
			return accepted;
		}
		const request = {
			Title: "Delete Vision?",
			Content: '<p>Delete this Vision?</p><label class="control-field">Theme<select><option>Light</option><option>Dark</option></select></label><label class="control-field">Note<textarea></textarea></label><label class="control-field">Name<input></label>',
			CommitAsync
		};
		popup.Open(request);
		const dialog = popup.Root;
		const heading = dialog.querySelector<HTMLElement>(".control-window-header h2")!;
		const body = popup.Content;
		const button = dialog.querySelector<HTMLElement>(".dialog-actions button")!;

		expect(getComputedStyle(dialog).fontSize).toBe("13px");
		expect(getComputedStyle(heading).fontSize).toBe("14px");
		expect(getComputedStyle(body).fontSize).toBe("13px");
		expect(getComputedStyle(button).fontSize).toBe("12px");
		expect(getComputedStyle(button).minHeight).toBe("30px");
		expect(getComputedStyle(dialog).borderRadius).toMatch(/^0(?:px)?$/);
		expect(getComputedStyle(button).borderRadius).toMatch(/^0(?:px)?$/);
		// All shared fields retain their original border and have no focus ring.
		for (const field of dialog.querySelectorAll<HTMLElement>("select, textarea, input"))
		{
			const unfocusedBorder = getComputedStyle(field).borderColor;
			field.focus();
			const focusedStyle = getComputedStyle(field);
			expect(focusedStyle.borderColor).toBe(unfocusedBorder);
		}
		expect(Array.from(dialog.querySelectorAll(".dialog-actions button"), function Label(action): string | null
		{
			return action.textContent;
		})).toEqual(["Cancel", "OK"]);
		expect(commits).toBe(0);
		dialog.querySelector<HTMLButtonElement>("[data-dialog-cancel]")!.click();
		expect(popup.IsOpen).toBe(false);
		expect(commits).toBe(0);
		popup.Open(request);
		const form = dialog.querySelector("form")!;
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(commits).toBe(1);
		expect(dialog.querySelector<HTMLButtonElement>("[data-dialog-ok]")?.disabled).toBe(true);
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		expect(popup.IsOpen).toBe(true);
		finishCommit(true);
		await vi.waitFor(function CommitCompleted(): void
		{
			expect(popup.IsOpen).toBe(false);
		});

		popup.Dispose();
	});
});
