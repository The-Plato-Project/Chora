// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { WorkspaceSidebar, type WorkspaceSidebarExtension } from "../../src/renderer/workspace/WorkspaceSidebar.js";
import { WorkspaceShellPanel } from "../../src/renderer/workspace/WorkspaceShellPanel.js";
import { WorkspaceLayoutPanel } from "../../src/renderer/workspace/WorkspaceLayoutPanel.js";

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
		const shell = new WorkspaceShellPanel(root, events);
		const layout = new WorkspaceLayoutPanel(root, events);
		const roots = shell.GetRoots();
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
		const shellElement = root.querySelector<HTMLElement>(".shell");
		shellElement?.classList.add("left-collapsed");
		const wordsButton = root.querySelector<HTMLButtonElement>('[data-sidebar-id="words"]');
		wordsButton?.click();
		await vi.waitFor(function SidebarOpened(): void
		{
			const collapsed = shellElement?.classList.contains("left-collapsed");
			expect(collapsed).toBe(false);
		});
		const pressed = wordsButton?.getAttribute("aria-pressed");
		expect(pressed).toBe("true");
		sidebar.Dispose();
		layout.Dispose();
		shell.Dispose();
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
		await events.PublishAsync("dream.passage-filter-changed", {});
		hidden = wordsPanel?.hidden;
		expect(hidden).toBe(true);
		const explorerPressed = explorerButton?.getAttribute("aria-pressed");
		expect(explorerPressed).toBe("true");
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
