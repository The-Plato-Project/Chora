// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PopupPanel } from "../../src/renderer/ui/PopupPanel.js";

afterEach(function Cleanup(): void
{
	document.body.replaceChildren();
	document.head.replaceChildren();
});

describe("Popup styles", function PopupStyleTests()
{
	it("uses the compact Chora UI type and action controls", function UsesApplicationStyles(): void
	{
		const stylesheet = document.createElement("style");
		const base = readFileSync("src/renderer/styles/base.css", "utf8");
		const panels = readFileSync("src/renderer/styles/left-tab-panels.css", "utf8");
		stylesheet.textContent = `${base}\n${panels}`;
		document.head.append(stylesheet);
		const popup = new PopupPanel("Remove Signal?");
		popup.SetBodyHtml(`<p>Remove this Signal from the Idea?</p><div class="popup-actions"><button type="button">Cancel</button><button data-signal-remove-confirm type="button">Remove Signal</button></div>`);
		popup.Open();
		const dialog = document.querySelector<HTMLElement>(".popup-dialog")!;
		const heading = dialog.querySelector<HTMLElement>(".popup-header h4")!;
		const body = dialog.querySelector<HTMLElement>(".popup-body")!;
		const button = dialog.querySelector<HTMLElement>(".popup-actions button")!;

		expect(getComputedStyle(dialog).fontSize).toBe("13px");
		expect(getComputedStyle(heading).fontSize).toBe("14px");
		expect(getComputedStyle(body).fontSize).toBe("13px");
		expect(getComputedStyle(button).fontSize).toBe("12px");
		expect(getComputedStyle(button).minHeight).toBe("30px");

		popup.Dispose();
	});
});
