import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, BrowserWindow, ipcMain, nativeTheme, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../src/shared/contracts/IpcChannels.js";
import { AppearanceIpcController } from "../../src/main/shell/AppearanceIpcController.js";
import { ApplicationMenuIpcController } from "../../src/main/shell/ApplicationMenuIpcController.js";
import { ChoraWindowManager } from "../../src/main/bootstrap/WindowManager.js";
import { Errors } from "../../src/main/diagnostics/MainErrorManager.js";

vi.mock("electron", function MockElectron()
{
	return {
		app: { getAppPath: vi.fn(() => "C:\\Chora"), quit: vi.fn() },
		BrowserWindow: vi.fn(),
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
		nativeTheme: { themeSource: "system" },
		screen: { getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
		Menu: { buildFromTemplate: vi.fn() }
	};
});

function CreateWindow()
{
	const window = new EventEmitter() as EventEmitter & {
		webContents: EventEmitter & { mainFrame: object };
		loadFile: ReturnType<typeof vi.fn>;
		isDestroyed: ReturnType<typeof vi.fn>;
		isMinimized: ReturnType<typeof vi.fn>;
		show: ReturnType<typeof vi.fn>;
		restore: ReturnType<typeof vi.fn>;
		getNormalBounds: ReturnType<typeof vi.fn>;
		isMaximized: ReturnType<typeof vi.fn>;
		isFullScreen: ReturnType<typeof vi.fn>;
		maximize: ReturnType<typeof vi.fn>;
		setFullScreen: ReturnType<typeof vi.fn>;
		setAccentColor: ReturnType<typeof vi.fn>;
	};
	window.webContents = Object.assign(new EventEmitter(), { mainFrame: {} });
	window.loadFile = vi.fn().mockResolvedValue(undefined);
	window.isDestroyed = vi.fn(() => false);
	window.isMinimized = vi.fn(() => false);
	window.show = vi.fn();
	window.restore = vi.fn();
	window.getNormalBounds = vi.fn(() => ({ x: 120, y: 80, width: 1200, height: 800 }));
	window.isMaximized = vi.fn(() => true);
	window.isFullScreen = vi.fn(() => false);
	window.maximize = vi.fn();
	window.setFullScreen = vi.fn();
	window.setAccentColor = vi.fn();
	return window;
}

beforeEach(function ResetMocks(): void
{
	vi.clearAllMocks();
});

describe("ChoraWindowManager", function ChoraWindowManagerTests()
{
	it.each([
		{ minimized: false, restores: 0 },
		{ minimized: true, restores: 1 }
	])("shows after loading and restores only a launcher-minimized window: $minimized", async function ShowsInitialWindow({ minimized, restores }): Promise<void>
	{
		const window = CreateWindow();
		window.isMinimized.mockReturnValue(minimized);
		vi.mocked(BrowserWindow).mockImplementationOnce(function CreateBrowserWindow()
		{
			return window as unknown as BrowserWindow;
		});

		const directory = mkdtempSync(path.join(tmpdir(), "chora-window-state-"));
		const statePath = path.join(directory, "window-state.json");
		writeFileSync(statePath, JSON.stringify({ bounds: { x: -4000, y: -2000, width: 1000, height: 700 },
			maximized: true, fullscreen: false }));
		try
		{
			const manager = new ChoraWindowManager(statePath);
			manager.Open();
			await Promise.resolve();
			const appearance = new AppearanceIpcController(manager);
			appearance.Register();
			expect(nativeTheme.themeSource).toBe("light");
			const handler = vi.mocked(ipcMain.handle).mock.calls.find(function FindAppearance(call): boolean
			{
				return call[0] === IPC_CHANNELS.setAppearance;
			})![1];
			const request = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
			await handler(request, "dark", "#414141");
			expect(nativeTheme.themeSource).toBe("dark");
			if (process.platform === "win32") expect(window.setAccentColor).toHaveBeenLastCalledWith("#414141");
			await handler(request, "light", "#dfe7d6");
			expect(nativeTheme.themeSource).toBe("light");
			if (process.platform === "win32") expect(window.setAccentColor).toHaveBeenLastCalledWith("#dfe7d6");
			appearance.Unregister();
			const menu = new ApplicationMenuIpcController(manager);
			menu.Register();
			const menuHandler = vi.mocked(ipcMain.handle).mock.calls.find(function FindMenu(call): boolean
			{
				return call[0] === IPC_CHANNELS.applicationMenuCommand;
			})![1];
			const unknownCommand = await menuHandler(request, "arbitrary-command");
			expect(unknownCommand).toMatchObject({ ok: false, error: { code: "INVALID_MENU_COMMAND" } });
			const untrusted = await menuHandler({ ...request, senderFrame: {} } as IpcMainInvokeEvent, "quit");
			expect(untrusted).toMatchObject({ ok: false, error: { code: "UNTRUSTED_MENU_COMMAND" } });
			expect(app.quit).not.toHaveBeenCalled();
			const quit = await menuHandler(request, "quit");
			expect(quit).toMatchObject({ ok: true });
			expect(app.quit).toHaveBeenCalledOnce();
			menu.Unregister();
			if (process.platform === "win32")
			{
				expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ roundedCorners: false }));
			}

			expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ show: false, x: 0, y: 0, width: 1000, height: 700 }));
			expect(window.maximize).toHaveBeenCalledOnce();
			expect(window.show).toHaveBeenCalledOnce();
			expect(window.restore).toHaveBeenCalledTimes(restores);
			expect(window.show.mock.invocationCallOrder[0]).toBeLessThan(window.isMinimized.mock.invocationCallOrder[0]!);
			if (restores > 0) expect(window.isMinimized.mock.invocationCallOrder[0]).toBeLessThan(window.restore.mock.invocationCallOrder[0]!);
			window.isMinimized.mockReturnValue(false);
			window.emit("resize");
			window.emit("close");
			expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({ bounds: { x: 120, y: 80, width: 1200, height: 800 },
				maximized: true, fullscreen: false });
		}
		finally
		{
			unlinkSync(statePath);
			rmdirSync(directory);
		}
	});

	it("reports a renderer-document load failure", async function ReportsLoadFailureAsync(): Promise<void>
	{
		const error = new Error("missing renderer");
		const window = CreateWindow();
		window.loadFile.mockRejectedValueOnce(error);
		vi.mocked(BrowserWindow).mockImplementationOnce(function CreateBrowserWindow()
		{
			return window as unknown as BrowserWindow;
		});
		const report = vi.spyOn(Errors, "Error").mockImplementation(() => undefined);

		new ChoraWindowManager().Open();
		await Promise.resolve();

		expect(report).toHaveBeenCalledWith("ElectronWindow", "Chora window content could not be loaded.", error);
		expect(window.show).not.toHaveBeenCalled();
	});
});
