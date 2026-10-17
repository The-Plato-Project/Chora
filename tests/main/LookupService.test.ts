import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMain, session, shell, WebContentsView } from "electron";
import { LookupService } from "../../src/main/library/LookupService.js";
import { LookupIpcController } from "../../src/main/library/LookupIpcController.js";
import { ChoraWindowManager } from "../../src/main/bootstrap/WindowManager.js";
import { IPC_CHANNELS } from "../../src/shared/contracts/IpcChannels.js";

vi.mock("electron", function MockElectron()
{
	const partition = {
		setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
		listenerCount: vi.fn().mockReturnValue(0), on: vi.fn()
	};
	return {
		WebContentsView: vi.fn(),
		session: { fromPartition: vi.fn().mockReturnValue(partition) },
		shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
	};
});

describe("Dictionary view", function LookupTests()
{
	function CreateFixture()
	{
		const contents = Object.assign(new EventEmitter(), {
			loadURL: vi.fn().mockResolvedValue(undefined), getURL: vi.fn().mockReturnValue("https://logeion.uchicago.edu/logos"),
			setWindowOpenHandler: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false), close: vi.fn(), reload: vi.fn(),
			navigationHistory: { canGoBack: vi.fn().mockReturnValue(true), goBack: vi.fn(), canGoForward: vi.fn().mockReturnValue(false), goForward: vi.fn() }
		});
		const view = { webContents: contents, setVisible: vi.fn(), setBounds: vi.fn() };
		vi.mocked(WebContentsView).mockImplementation(function CreateView() { return view as unknown as WebContentsView; });
		const host = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false), getZoomFactor: vi.fn().mockReturnValue(1), mainFrame: {} });
		const owner = Object.assign(new EventEmitter(), {
			webContents: host, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
			isDestroyed: vi.fn().mockReturnValue(false), getContentBounds: vi.fn().mockReturnValue({ width: 1000, height: 800 })
		});
		const windows = { GetWindow: function GetWindow() { return owner; } } as unknown as ChoraWindowManager;
		const service = new LookupService(windows);
		return { contents, view, host, owner, windows, service };
	}

	beforeEach(function Reset(): void { vi.clearAllMocks(); });

	it.each(["https://evil.example", "https://logeion.uchicago.edu.evil.example", "http://logeion.uchicago.edu", "https://user@logeion.uchicago.edu", "javascript:alert(1)", "file:///etc/passwd", "https://logeion.uchicago.edu:8443/test"])("rejects non-dictionary URL %s", function RejectUrl(url): void
	{
		expect(LookupService.IsAllowedUrl(url)).toBe(false);
	});

	it("isolates external content, constrains bounds, and cleans up", async function IsolatesViewAsync()
	{
		const { service, view, contents, owner, host } = CreateFixture();
		await service.OpenAsync("logos");
		expect(contents.loadURL).toHaveBeenCalledWith("https://logeion.uchicago.edu/logos");
		const preferences = vi.mocked(WebContentsView).mock.calls[0][0]?.webPreferences;
		expect(preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
		expect(preferences?.preload).toBeUndefined();
		expect(preferences?.session).toBeDefined();
		const partition = session.fromPartition("chora-dictionary");
		const permissionCallback = vi.fn();
		vi.mocked(partition.setPermissionRequestHandler).mock.calls[0][0]?.(contents as never, "media", permissionCallback, {} as never);
		expect(permissionCallback).toHaveBeenCalledWith(false);
		const popup = contents.setWindowOpenHandler.mock.calls[0][0];
		expect(popup({ url: "https://evil.example" })).toEqual({ action: "deny" });
		service.SetBounds({ x: 800, y: 600, width: 500, height: 400 });
		expect(view.setBounds).toHaveBeenLastCalledWith({ x: 800, y: 600, width: 200, height: 200 });
		await service.ExecuteAsync("back");
		expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce();
		await service.ExecuteAsync("external");
		expect(shell.openExternal).toHaveBeenCalledWith("https://logeion.uchicago.edu/logos");
		const event = { preventDefault: vi.fn() };
		contents.emit("will-navigate", event, "https://evil.example");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(service.GetState().error).toContain("outside Logeion");
		expect(view.setVisible).toHaveBeenLastCalledWith(false);
		service.Close();
		expect(owner.contentView.removeChildView).toHaveBeenCalledWith(view);
		expect(contents.close).toHaveBeenCalledOnce();
		expect(host.listenerCount("did-start-loading")).toBe(0);
		expect(service.GetState().open).toBe(false);
	});

	it.each([false, true])("cleans up a destroyed window with dictionary destroyed=%s", async function ClosesDestroyedWindowAsync(dictionaryDestroyed)
	{
		const { service, contents, owner, host } = CreateFixture();
		await service.OpenAsync("logos");
		owner.isDestroyed.mockReturnValue(true);
		contents.isDestroyed.mockReturnValue(dictionaryDestroyed);
		host.send.mockClear();
		Object.defineProperty(owner, "webContents", { get: function DestroyedContents(): never { throw new TypeError("Object has been destroyed"); } });
		Object.defineProperty(owner, "contentView", { get: function DestroyedView(): never { throw new TypeError("Object has been destroyed"); } });
		expect(function CloseWindow(): void { owner.emit("closed"); }).not.toThrow();
		expect(function CloseAgain(): void { service.Close(); }).not.toThrow();
		expect(contents.close).toHaveBeenCalledTimes(dictionaryDestroyed ? 0 : 1);
		expect(host.send).not.toHaveBeenCalled();
		expect(service.GetState()).toMatchObject({ open: false, error: null });
		expect(owner.listenerCount("closed")).toBe(0);
		expect(owner.listenerCount("resize")).toBe(0);
	});

	it("allows reentrant cleanup without closing the dictionary twice", async function ClosesOnceAsync()
	{
		const { service, contents } = CreateFixture();
		await service.OpenAsync("logos");
		contents.close.mockImplementation(function Reenter(): void { service.Close(); });
		service.Close();
		expect(contents.close).toHaveBeenCalledOnce();
		expect(service.GetState().open).toBe(false);
	});

	it("reloads same-page history destinations for Back and Forward without creating entries", async function ReloadsHistoryAsync()
	{
		const { service, contents } = CreateFixture();
		await service.OpenAsync("logos");
		await service.ExecuteAsync("back");
		contents.getURL.mockReturnValue("https://logeion.uchicago.edu/psyche");
		contents.navigationHistory.canGoBack.mockReturnValue(false);
		contents.navigationHistory.canGoForward.mockReturnValue(true);
		contents.emit("did-navigate-in-page", {}, contents.getURL(), false);
		expect(contents.reload).not.toHaveBeenCalled();
		contents.emit("did-navigate-in-page", {}, contents.getURL(), true);
		expect(contents.reload).toHaveBeenCalledTimes(1);
		expect(service.GetState()).toMatchObject({ url: contents.getURL(), canGoBack: false, canGoForward: true });
		await service.ExecuteAsync("forward");
		expect(contents.navigationHistory.goForward).toHaveBeenCalledOnce();
		contents.getURL.mockReturnValue("https://logeion.uchicago.edu/logos");
		contents.navigationHistory.canGoBack.mockReturnValue(true);
		contents.navigationHistory.canGoForward.mockReturnValue(false);
		contents.emit("did-navigate-in-page", {}, contents.getURL(), true);
		expect(contents.reload).toHaveBeenCalledTimes(2);
		expect(service.GetState()).toMatchObject({ canGoBack: true, canGoForward: false });
		contents.emit("did-navigate-in-page", {}, contents.getURL(), true);
		expect(contents.reload).toHaveBeenCalledTimes(2);
		expect(contents.loadURL).toHaveBeenCalledOnce();
		service.Close();
	});

	it("keeps failed loads recoverable and closes on host reload", async function RecoversAndCleansUpAsync()
	{
		const { service, contents, host } = CreateFixture();
		await service.OpenAsync("logos");
		contents.emit("did-fail-load", {}, -105, "offline", "https://logeion.uchicago.edu/logos", true);
		expect(service.GetState().error).toContain("could not be loaded");
		await service.ExecuteAsync("reload");
		expect(contents.reload).toHaveBeenCalledOnce();
		expect(service.GetState().error).toBeNull();
		host.emit("did-start-loading");
		expect(service.GetState().open).toBe(false);
		expect(contents.close).toHaveBeenCalledOnce();
	});

	it("rejects IPC from dictionary pages, subframes, and malformed bounds", async function RejectsUntrustedRequestsAsync()
	{
		const { service, windows, host } = CreateFixture();
		const controller = new LookupIpcController(service, windows);
		controller.Register();
		const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
		const open = handlers.get(IPC_CHANNELS.lookUpWord)!;
		const bounds = handlers.get(IPC_CHANNELS.setLookupBounds)!;
		await expect(open({ sender: {}, senderFrame: {} } as never, "logos")).rejects.toThrow("Untrusted");
		await expect(open({ sender: host, senderFrame: {} } as never, "logos")).rejects.toThrow("Untrusted");
		const trusted = { sender: host, senderFrame: host.mainFrame } as never;
		expect(function InvalidBounds(): void { bounds(trusted, { x: NaN, y: 0, width: 10, height: 10 }); }).toThrow("Invalid");
		await open(trusted, "logos");
		expect(service.GetState().open).toBe(true);
		controller.Unregister();
		expect(ipcMain.removeHandler).toHaveBeenCalledTimes(4);
	});
});
