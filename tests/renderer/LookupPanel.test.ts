// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LookupController } from "../../src/renderer/library/lookup/LookupController.js";
import { LookupGateway } from "../../src/renderer/library/lookup/LookupGateway.js";
import { LookupPanel } from "../../src/renderer/library/lookup/LookupPanel.js";
import { LookupStore } from "../../src/renderer/library/lookup/LookupStore.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import type { LookupState } from "../../src/shared/library/LookupTypes.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";

describe("Dictionary panel", function LookupPanelTests()
{
	afterEach(function Cleanup(): void { document.body.replaceChildren(); vi.restoreAllMocks(); });

	it("opens below the reader, resizes, routes controls, and displays failures", async function OperatesPanelAsync()
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const store = new LookupStore();
		const gateway = new LookupGateway();
		const initial: LookupState = { open: false, url: "", loading: false, canGoBack: false, canGoForward: false, error: null };
		let receive: (state: LookupState) => void = function InitialReceive(): void {};
		const unsubscribe = vi.fn();
		vi.spyOn(gateway, "Subscribe").mockImplementation(function Subscribe(handler) { receive = handler; return unsubscribe; });
		vi.spyOn(gateway, "GetStateAsync").mockResolvedValue(initial);
		const execute = vi.spyOn(gateway, "ExecuteAsync").mockResolvedValue();
		vi.spyOn(gateway, "SetBoundsAsync").mockResolvedValue();
		const controller = new LookupController(events, store, gateway, new ErrorManager(events));
		const workspace = document.createElement("div");
		workspace.innerHTML = '<section data-document-panel>Reader stays mounted</section><section data-lookup-panel hidden></section>';
		document.body.append(workspace);
		vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 700));
		const root = workspace.querySelector<HTMLElement>("[data-lookup-panel]")!;
		const reader = workspace.firstElementChild;
		const panel = new LookupPanel(root, events, store, controller);
		try
		{
			await controller.StartAsync();
			expect(root.hidden).toBe(true);
			receive({ open: true, url: "https://logeion.uchicago.edu/logos", loading: true, canGoBack: false, canGoForward: false, error: null });
			expect(root.hidden).toBe(false);
			expect(root.previousElementSibling).toBe(reader);
			expect(root.querySelector("iframe, webview")).toBeNull();
			expect(root.querySelector("[data-lookup-title]")?.textContent).toBe("Logeion: logos");
			expect(root.querySelector<HTMLButtonElement>('[data-lookup-command="back"]')?.disabled).toBe(true);
			expect(root.querySelector<HTMLButtonElement>('[data-lookup-command="forward"]')?.disabled).toBe(true);
			expect(root.querySelector('[role="status"]')?.textContent).toBe("Loading...");
			const divider = root.querySelector<HTMLElement>('[role="separator"]')!;
			divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
			expect(root.style.height).toBe("344px");
			receive({ ...store.GetState(), loading: false, canGoBack: true, canGoForward: true });
			for (const command of ["back", "forward", "reload", "external", "close"])
			{
				root.querySelector<HTMLButtonElement>(`[data-lookup-command="${command}"]`)!.click();
				expect(execute).toHaveBeenLastCalledWith(command);
			}
			receive({ ...store.GetState(), error: "Network unavailable" });
			expect(root.querySelector<HTMLElement>('[role="alert"]')?.hidden).toBe(false);
			expect(root.querySelector('[role="alert"]')?.textContent).toBe("Network unavailable");
			receive(initial);
			expect(root.hidden).toBe(true);
			expect(workspace.firstElementChild).toBe(reader);
		}
		finally
		{
			panel.Dispose();
			controller.Dispose();
		}
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
