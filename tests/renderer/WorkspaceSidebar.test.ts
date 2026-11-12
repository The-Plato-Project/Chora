// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { WorkspaceSidebar, type WorkspaceSidebarExtension } from "../../src/renderer/workspace/WorkspaceSidebar.js";
import { WorkspaceShellPanel } from "../../src/renderer/workspace/WorkspaceShellPanel.js";
import { WorkspaceLayoutPanel } from "../../src/renderer/workspace/WorkspaceLayoutPanel.js";
import { ApplicationMenuController } from "../../src/renderer/workspace/ApplicationMenuController.js";

describe("WorkspaceSidebar", function WorkspaceSidebarTests()
{
	afterEach(function Cleanup(): void
	{
		document.body.replaceChildren();
		window.localStorage.clear();
	});

	it("reopens the selected sidebar without changing its extension", async function ReopensSidebarAsync(): Promise<void>
	{
		const root = document.createElement("div");
		document.body.append(root);
		const events = new ChoraEventBus<ChoraEvents>();
		const execute = vi.fn().mockResolvedValue(undefined);
		const menuController = new ApplicationMenuController(events, { ExecuteAsync: execute });
		let openSettings: () => void = function Ignore(): void {};
		const unsubscribe = vi.fn();
		window.chora = { SubscribeSettingsRequested: function Subscribe(callback: () => void)
		{
			openSettings = callback;
			return unsubscribe;
		} } as unknown as typeof window.chora;
		const shell = new WorkspaceShellPanel(root, events);
		const requested = vi.fn();
		events.Subscribe("workspace.settings-open-requested", requested);
		openSettings();
		expect(requested).toHaveBeenCalledOnce();
		const menuTriggers = root.querySelectorAll<HTMLButtonElement>(".menu-bar-trigger");
		expect(Array.from(menuTriggers, function Label(trigger): string | null
		{
			return trigger.textContent;
		})).toEqual(["File", "Settings", "Help"]);
		menuTriggers[1]!.click();
		expect(menuTriggers[1]!.getAttribute("aria-expanded")).toBe("true");
		root.querySelector<HTMLButtonElement>('[data-menu-command="settings"]')!.click();
		expect(requested).toHaveBeenCalledTimes(2);
		expect(menuTriggers[1]!.getAttribute("aria-expanded")).toBe("false");
		menuTriggers[0]!.focus();
		menuTriggers[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(document.activeElement?.getAttribute("data-menu-command")).toBe("quit");
		document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(document.activeElement?.getAttribute("data-menu-command")).toBe("settings");
		document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.activeElement).toBe(menuTriggers[1]);
		menuTriggers[2]!.click();
		root.querySelector<HTMLButtonElement>('[data-menu-command="logs"]')!.click();
		expect(execute).toHaveBeenCalledWith("logs");
		window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true }));
		expect(requested).toHaveBeenCalledTimes(3);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true }));
		expect(execute).toHaveBeenCalledWith("quit");
		menuTriggers[0]!.click();
		root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(menuTriggers[0]!.getAttribute("aria-expanded")).toBe("false");
		const layout = new WorkspaceLayoutPanel(root, events);
		const roots = shell.GetRoots();
		expect(root.querySelectorAll(".split-divider")).toHaveLength(1);
		expect(root.querySelector(".shell > .status-bar-control")).not.toBeNull();
		function MountPanel(_root: HTMLElement): { Dispose(): void }
		{
			function Dispose(): void
			{
			}
			const owner = { Dispose };
			return owner;
		}
		const extensions: readonly WorkspaceSidebarExtension[] = [
			{ id: "explorer", title: "Explorer", icon: "", Mount: MountPanel },
			{ id: "words", title: "Words", icon: "", Mount: MountPanel }
		];
		const sidebar = new WorkspaceSidebar(roots.sidebarRail, roots.sidebarHost, events, extensions);
		const divider = root.querySelector<HTMLElement>('.split-divider[data-split-before="explorer"]');
		divider?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
		const explorerHost = root.querySelector<HTMLElement>('[data-split-pane="explorer"]');
		expect(explorerHost?.dataset.collapsed).toBe("true");
		const wordsButton = root.querySelector<HTMLButtonElement>('[data-sidebar-id="words"]');
		wordsButton?.click();
		await vi.waitFor(function SidebarOpened(): void
		{
			expect(explorerHost?.dataset.collapsed).toBe("false");
		});
		const pressed = wordsButton?.getAttribute("aria-pressed");
		expect(pressed).toBe("true");
		sidebar.Dispose();
		layout.Dispose();
		shell.Dispose();
		menuController.Dispose();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("switches persistent panels and disposes their owners", async function SwitchesPanelsAsync(): Promise<void>
	{
		const rail = document.createElement("nav");
		const host = document.createElement("div");
		document.body.append(rail, host);
		const events = new ChoraEventBus<ChoraEvents>();
		const disposeExplorer = vi.fn();
		const disposeWords = vi.fn();
		function MountExplorer(root: HTMLElement): { Dispose(): void }
		{
			root.textContent = "Explorer contents";
			const owner = { Dispose: disposeExplorer };
			return owner;
		}
		function MountWords(root: HTMLElement): { Dispose(): void }
		{
			const input = document.createElement("input");
			input.value = "reader selection";
			root.append(input);
			const owner = { Dispose: disposeWords };
			return owner;
		}
		const extensions: readonly WorkspaceSidebarExtension[] = [
			{ id: "explorer", title: "Explorer", icon: "", Mount: MountExplorer },
			{ id: "words", title: "Words", icon: "", Mount: MountWords }
		];
		const sidebar = new WorkspaceSidebar(rail, host, events, extensions);
		const explorerButton = rail.querySelector<HTMLButtonElement>('[data-sidebar-id="explorer"]');
		const wordsButton = rail.querySelector<HTMLButtonElement>('[data-sidebar-id="words"]');
		const wordsPanel = host.querySelector<HTMLElement>('[aria-label="Words"]');
		let hidden = wordsPanel?.hidden;
		expect(hidden).toBe(true);
		wordsButton?.click();
		hidden = wordsPanel?.hidden;
		expect(hidden).toBe(false);
		const wordsPressed = wordsButton?.getAttribute("aria-pressed");
		expect(wordsPressed).toBe("true");
		explorerButton?.click();
		hidden = wordsPanel?.hidden;
		expect(hidden).toBe(true);
		wordsButton?.click();
		const input = wordsPanel?.querySelector<HTMLInputElement>("input");
		expect(input?.value).toBe("reader selection");
		await events.PublishAsync("workspace.sidebar-select-requested", { id: "explorer" });
		expect(wordsPanel?.hidden).toBe(true);
		expect(explorerButton?.getAttribute("aria-pressed")).toBe("true");
		sidebar.Dispose();
		expect(disposeExplorer).toHaveBeenCalledOnce();
		expect(disposeWords).toHaveBeenCalledOnce();
	});

	it("rejects duplicate extension identities before mounting panels", function RejectsDuplicates(): void
	{
		const rail = document.createElement("nav");
		const host = document.createElement("div");
		const events = new ChoraEventBus<ChoraEvents>();
		const mount = vi.fn();
		const extension: WorkspaceSidebarExtension = { id: "explorer", title: "Explorer", icon: "", Mount: mount };
		function CreateSidebar(): void
		{
			new WorkspaceSidebar(rail, host, events, [extension, extension]);
		}
		expect(CreateSidebar).toThrow("Invalid or duplicate sidebar extension");
		expect(mount).not.toHaveBeenCalled();
	});
});
