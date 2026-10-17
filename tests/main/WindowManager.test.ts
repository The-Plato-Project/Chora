import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "electron";
import { ChoraWindowManager } from "../../src/main/bootstrap/WindowManager.js";
import { Errors } from "../../src/main/diagnostics/MainErrorManager.js";

vi.mock("electron", function MockElectron()
{
	return {
		app: { getAppPath: vi.fn(() => "C:\\Chora") },
		BrowserWindow: vi.fn(),
		Menu: { buildFromTemplate: vi.fn() }
	};
});

function CreateWindow()
{
	const window = new EventEmitter() as EventEmitter & {
		webContents: EventEmitter;
		loadFile: ReturnType<typeof vi.fn>;
		isDestroyed: ReturnType<typeof vi.fn>;
		isMinimized: ReturnType<typeof vi.fn>;
		show: ReturnType<typeof vi.fn>;
		restore: ReturnType<typeof vi.fn>;
	};
	window.webContents = new EventEmitter();
	window.loadFile = vi.fn().mockResolvedValue(undefined);
	window.isDestroyed = vi.fn(() => false);
	window.isMinimized = vi.fn(() => false);
	window.show = vi.fn();
	window.restore = vi.fn();
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

		new ChoraWindowManager().Open();
		await Promise.resolve();

		expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ show: false }));
		expect(window.show).toHaveBeenCalledOnce();
		expect(window.restore).toHaveBeenCalledTimes(restores);
		expect(window.show.mock.invocationCallOrder[0]).toBeLessThan(window.isMinimized.mock.invocationCallOrder[0]!);
		if (restores > 0) expect(window.isMinimized.mock.invocationCallOrder[0]).toBeLessThan(window.restore.mock.invocationCallOrder[0]!);
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
