import { describe, expect, it, vi } from "vitest";
import { Menu, BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";
import { IPC_CHANNELS } from "../../src/shared/contracts/IpcChannels.js";
import { ChoraApplication } from "../../src/main/bootstrap/ChoraApplication.js";
import { CreateApplicationMenu } from "../../src/main/shell/ApplicationMenu.js";
import { ShowEditContextMenu, ShowFormattingContextMenu, ShowSelectionContextMenu } from "../../src/main/shell/ContextMenu.js";

const applicationMocks = vi.hoisted(function CreateApplicationMocks()
{
	return {
		libraryStart: vi.fn(),
		libraryStop: vi.fn(),
		visionsStart: vi.fn(),
		visionsStop: vi.fn(),
		windowOpen: vi.fn(),
		platosiStart: vi.fn(),
		platosiStop: vi.fn()
	};
});

vi.mock("electron", function MockElectron()
{
	return { Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
		BrowserWindow: { getFocusedWindow: vi.fn() }, nativeTheme: { themeSource: "system" },
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } };
});

vi.mock("../../src/main/bootstrap/Environment.js", function MockEnvironment()
{
	return { LoadEnvironmentFiles: vi.fn() };
});

vi.mock("../../src/main/platosi/PlatoSiClient.js", function MockPlatoSi()
{
	return {
		PlatoSiClient: vi.fn(function PlatoSiClient()
		{
			return { StartAsync: applicationMocks.platosiStart, StopAsync: applicationMocks.platosiStop };
		})
	};
});

vi.mock("../../src/main/bootstrap/WindowManager.js", function MockWindowManager()
{
	return {
		ChoraWindowManager: vi.fn(function ChoraWindowManager()
		{
			return { Open: applicationMocks.windowOpen };
		})
	};
});

vi.mock("../../src/main/library/LibraryModule.js", function MockLibraryModule()
{
	return {
		LibraryModule: vi.fn(function LibraryModule()
		{
			return {
				GetService: function GetService() { return {}; },
				Start: applicationMocks.libraryStart,
				Stop: applicationMocks.libraryStop
			};
		})
	};
});

vi.mock("../../src/main/visions/VisionModule.js", function MockVisionModule()
{
	return {
		VisionModule: vi.fn(function VisionModule()
		{
			return {
				PrepareAsync: vi.fn(),
				Start: applicationMocks.visionsStart,
				Stop: applicationMocks.visionsStop
			};
		})
	};
});

describe("Application menu", function ApplicationMenuTests(): void
{
	it.each([
		["Bold", "bold"],
		["Italic", "italic"],
		["Quotation", "blockquote"],
		["Add link", "link"],
		["dismiss", null]
	])("returns the formatting choice %s and preserves clipboard commands", async function FormattingChoiceAsync(choice, expected): Promise<void>
	{
		const window = {} as BrowserWindow;
		let template: MenuItemConstructorOptions[] = [];
		const popup = vi.fn(function Open(options): void
		{
			expect(options.window).toBe(window);
			const command = template.find(function Matches(item): boolean { return item.label === choice; });
			command?.click?.({} as never, window, {} as never);
			options.callback();
		});
		vi.mocked(Menu.buildFromTemplate).mockImplementationOnce(function Build(items): ReturnType<typeof Menu.buildFromTemplate>
		{
			template = items;
			return { popup } as unknown as ReturnType<typeof Menu.buildFromTemplate>;
		});
		const params = { misspelledWord: "", dictionarySuggestions: [], selectionText: "selected", editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as ContextMenuParams;
		const action = await ShowFormattingContextMenu(window, params);
		expect(action).toBe(expected);
		expect(template.map(function Role(item): string | undefined { return item.role; })).toEqual(expect.arrayContaining(["cut", "copy", "paste", "selectAll"]));
	});

	it.each([
		["Bulleted list", "bullet_list"],
		["Numbered list", "ordered_list"]
	])("returns the nested list choice %s", async function ListChoiceAsync(choice, expected): Promise<void>
	{
		const window = {} as BrowserWindow;
		let template: MenuItemConstructorOptions[] = [];
		const popup = vi.fn(function Open(options): void
		{
			const lists = template.find(function FindLists(item): boolean { return item.label === "Lists"; });
			const submenu = lists?.submenu as MenuItemConstructorOptions[] | undefined;
			const command = submenu?.find(function Matches(item): boolean { return item.label === choice; });
			command?.click?.({} as never, window, {} as never);
			options.callback();
		});
		vi.mocked(Menu.buildFromTemplate).mockImplementationOnce(function Build(items): ReturnType<typeof Menu.buildFromTemplate>
		{
			template = items;
			return { popup } as unknown as ReturnType<typeof Menu.buildFromTemplate>;
		});
		const params = { misspelledWord: "", dictionarySuggestions: [], selectionText: "selected", editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as ContextMenuParams;
		const action = await ShowFormattingContextMenu(window, params);
		expect(action).toBe(expected);
	});

	it.each([
		["Copy anchor", "copy-anchor"],
		["Copy text only", "copy-text-only"]
	])("returns the reader selection choice %s", async function SelectionChoiceAsync(choice, expected): Promise<void>
	{
		let template: MenuItemConstructorOptions[] = [];
		const popup = vi.fn(function Open(options): void
		{
			const command = template.find(function Matches(item): boolean { return item.label === choice; });
			command?.click?.({} as never, {} as BrowserWindow, {} as never);
			options.callback();
		});
		vi.mocked(Menu.buildFromTemplate).mockImplementationOnce(function Build(items): ReturnType<typeof Menu.buildFromTemplate>
		{
			template = items;
			return { popup } as unknown as ReturnType<typeof Menu.buildFromTemplate>;
		});

		const action = await ShowSelectionContextMenu(true);

		expect(action).toBe(expected);
		expect(template.map(function Label(item): string | undefined { return item.label; })).toEqual([
			"Copy anchor",
			"Copy text only",
			"Open word"
		]);
	});

	it.each(["spelling", "Add to dictionary", "dismiss"])("offers spelling suggestions and handles %s", async function SpellingChoiceAsync(choice): Promise<void>
	{
		const session = { addWordToSpellCheckerDictionary: vi.fn() };
		const replaceMisspelling = vi.fn();
		const window = { webContents: { session, replaceMisspelling } } as unknown as BrowserWindow;
		let template: MenuItemConstructorOptions[] = [];
		const popup = vi.fn(function Open(options): void
		{
			const command = template.find(function Matches(item): boolean { return item.label === choice; });
			command?.click?.({} as never, window, {} as never);
			options.callback();
		});
		vi.mocked(Menu.buildFromTemplate).mockImplementationOnce(function Build(items): ReturnType<typeof Menu.buildFromTemplate>
		{
			template = items;
			return { popup } as unknown as ReturnType<typeof Menu.buildFromTemplate>;
		});
		const params = { misspelledWord: "speling", dictionarySuggestions: ["spelling"], selectionText: "", editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as ContextMenuParams;
		const action = await ShowFormattingContextMenu(window, params);
		expect(action).toBeNull();
		expect(replaceMisspelling).toHaveBeenCalledTimes(choice === "spelling" ? 1 : 0);
		if (choice === "spelling") expect(replaceMisspelling).toHaveBeenCalledWith("spelling");
		expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(choice === "Add to dictionary" ? 1 : 0);
		if (choice === "Add to dictionary") expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("speling");
		expect(template.map(function Label(item): string | undefined { return item.label; })).toEqual(expect.arrayContaining(["Bold", "Italic", "spelling", "Add to dictionary"]));
	});

	it.each([false, true])("retains dictionary actions without suggestions in formatting mode %s", async function NoSuggestionsAsync(formatting): Promise<void>
	{
		const window = { webContents: { session: {} } } as unknown as BrowserWindow;
		const params = { misspelledWord: "unrecognizedword", dictionarySuggestions: [], selectionText: "", editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } } as ContextMenuParams;
		const popup = vi.fn(function Open(options): void { options.callback?.(); });
		vi.mocked(Menu.buildFromTemplate).mockReturnValueOnce({ popup } as unknown as ReturnType<typeof Menu.buildFromTemplate>);
		if (formatting) await ShowFormattingContextMenu(window, params);
		else ShowEditContextMenu(window, params);
		const template = vi.mocked(Menu.buildFromTemplate).mock.lastCall?.[0] ?? [];
		expect(template).toEqual(expect.arrayContaining([
			expect.objectContaining({ label: "No suggestions", enabled: false }),
			expect.objectContaining({ label: "Add to dictionary" }),
			expect.objectContaining({ role: "cut", enabled: false })
		]));
	});

	it("keeps text selection in the reader and exposes only Quit in the File menu", function KeepsBundledLibraryMenu(): void
	{
		CreateApplicationMenu();
		const template = vi.mocked(Menu.buildFromTemplate).mock.lastCall?.[0] ?? [];
		const file = template.find(function FindFile(item): boolean { return item.label === "File"; });
		const commands = file?.submenu as MenuItemConstructorOptions[];
		expect(commands).toEqual([{ role: "quit" }]);
		const settings = template.find(function FindSettings(item): boolean { return item.label === "Settings"; });
		const settingsCommands = settings?.submenu as MenuItemConstructorOptions[];
		expect(settingsCommands[0]?.label).toBe("Chora settings");
		const send = vi.fn();
		vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({ isDestroyed: function IsDestroyed(): boolean { return false; },
			webContents: { send } } as unknown as BrowserWindow);
		settingsCommands[0]!.click!({} as never, {} as never, {} as never);
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.openSettings);
	});

	it("rolls back a failed start, retries cleanly, and stops the successful run once", async function RollsBackFailedStartAsync(): Promise<void>
	{
		vi.mocked(Menu.setApplicationMenu).mockImplementationOnce(function FailMenu(): never
		{
			throw new Error("menu failed");
		});

		const application = new ChoraApplication("documents", "internal");

		await expect(application.StartAsync()).rejects.toThrow("menu failed");
		expect(applicationMocks.libraryStart).toHaveBeenCalledTimes(1);
		expect(applicationMocks.visionsStart).toHaveBeenCalledTimes(1);
		expect(applicationMocks.visionsStop).toHaveBeenCalledTimes(1);
		expect(applicationMocks.libraryStop).toHaveBeenCalledTimes(1);

		await application.StartAsync();
		expect(applicationMocks.libraryStart).toHaveBeenCalledTimes(2);
		expect(applicationMocks.visionsStart).toHaveBeenCalledTimes(2);

		await application.StopAsync();
		await application.StopAsync();
		expect(applicationMocks.visionsStop).toHaveBeenCalledTimes(2);
		expect(applicationMocks.libraryStop).toHaveBeenCalledTimes(2);
	});
});
