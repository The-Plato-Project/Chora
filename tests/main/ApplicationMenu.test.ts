import { describe, expect, it, vi } from "vitest";
import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";
import { ChoraApplication } from "../../src/main/bootstrap/ChoraApplication.js";
import { CreateApplicationMenu } from "../../src/main/shell/ApplicationMenu.js";
import { ShowEditContextMenu, ShowFormattingContextMenu } from "../../src/main/shell/ContextMenu.js";

const applicationMocks = vi.hoisted(function CreateApplicationMocks()
{
	return {
		libraryList: vi.fn(),
		libraryStart: vi.fn(),
		libraryStop: vi.fn(),
		ideasStart: vi.fn(),
		ideasStop: vi.fn(),
		dreamsStart: vi.fn(),
		dreamsStop: vi.fn(),
		signalsStart: vi.fn(),
		signalsStop: vi.fn(),
		lookupRegister: vi.fn(),
		lookupUnregister: vi.fn(),
		windowOpen: vi.fn()
	};
});

vi.mock("electron", function MockElectron()
{
	return { Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() }, dialog: {} };
});

vi.mock("../../src/main/bootstrap/Environment.js", function MockEnvironment()
{
	return { LoadEnvironmentFiles: vi.fn() };
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
				GetService: function GetService() { return { ListAsync: applicationMocks.libraryList }; },
				Start: applicationMocks.libraryStart,
				Stop: applicationMocks.libraryStop
			};
		})
	};
});

vi.mock("../../src/main/ideas/IdeaModule.js", function MockIdeaModule()
{
	return {
		IdeaModule: vi.fn(function IdeaModule()
		{
			return { Start: applicationMocks.ideasStart, Stop: applicationMocks.ideasStop };
		})
	};
});

vi.mock("../../src/main/signals/SignalModule.js", function MockSignalModule()
{
	return {
		SignalModule: vi.fn(function SignalModule()
		{
			return {
				GetLibrary: function GetLibrary(): object { return {}; },
				Start: applicationMocks.signalsStart,
				Stop: applicationMocks.signalsStop
			};
		})
	};
});

vi.mock("../../src/main/dreams/DreamModule.js", function MockDreamModule()
{
	return {
		DreamModule: vi.fn(function DreamModule()
		{
			// Supplies the Dream use cases required by Idea composition.
			function GetService(): object
			{
				const service = {};

				return service;
			}

			const module = {
				GetService,
				Start: applicationMocks.dreamsStart,
				Stop: applicationMocks.dreamsStop
			};

			return module;
		})
	};
});

vi.mock("../../src/main/library/LookupService.js", function MockLookupService()
{
	return { LookupService: vi.fn() };
});

vi.mock("../../src/main/library/LookupIpcController.js", function MockLookupIpcController()
{
	return {
		LookupIpcController: vi.fn(function LookupIpcController()
		{
			return { Register: applicationMocks.lookupRegister, Unregister: applicationMocks.lookupUnregister };
		})
	};
});

describe("Application menu", function ApplicationMenuTests(): void
{
	it.each(["Bold", "Italic", "dismiss"])("returns the formatting choice %s and preserves clipboard commands", async function FormattingChoiceAsync(choice): Promise<void>
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
		const params = { misspelledWord: "", dictionarySuggestions: [], editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as ContextMenuParams;
		const action = await ShowFormattingContextMenu(window, params);
		expect(action).toBe(choice === "dismiss" ? null : choice.toLowerCase());
		expect(template.map(function Role(item): string | undefined { return item.role; })).toEqual(expect.arrayContaining(["cut", "copy", "paste", "selectAll"]));
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
		const params = { misspelledWord: "speling", dictionarySuggestions: ["spelling"], editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as ContextMenuParams;
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
		const params = { misspelledWord: "unrecognizedword", dictionarySuggestions: [], editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } } as ContextMenuParams;
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

	it("keeps external text opening without duplicating the reader work selector", function KeepsExternalTextOpening(): void
	{
		const send = vi.fn();
		const window = { webContents: { send } } as unknown as BrowserWindow;
		const windows = { GetWindow: function GetWindow(): BrowserWindow { return window; } };
		CreateApplicationMenu(windows, [{ id: "republic", title: "Republic", titleGreek: null, urn: null, author: "Plato", language: "grc", editor: null, fileName: "republic.json" }]);
		const template = vi.mocked(Menu.buildFromTemplate).mock.lastCall?.[0] ?? [];
		const file = template.find(function FindFile(item): boolean { return item.label === "File"; });
		const commands = file?.submenu as MenuItemConstructorOptions[];
		const choose = commands.find(function FindChoose(item): boolean { return item.label === "Choose Text"; });
		expect(choose).toBeUndefined();
		expect(commands.some(function HasOpenText(item): boolean { return item.label === "Open Text..."; })).toBe(true);
	});

	it("rolls back a failed start, retries cleanly, and stops the successful run once", async function RollsBackFailedStartAsync(): Promise<void>
	{
		applicationMocks.libraryList
			.mockRejectedValueOnce(new Error("menu failed"))
			.mockResolvedValueOnce([]);

		const application = new ChoraApplication("documents");

		await expect(application.StartAsync()).rejects.toThrow("menu failed");
		expect(applicationMocks.libraryStart).toHaveBeenCalledTimes(1);
		expect(applicationMocks.lookupRegister).toHaveBeenCalledTimes(1);
		expect(applicationMocks.ideasStart).toHaveBeenCalledTimes(1);
		expect(applicationMocks.dreamsStart).toHaveBeenCalledTimes(1);
		expect(applicationMocks.lookupUnregister).toHaveBeenCalledTimes(1);
		expect(applicationMocks.dreamsStop).toHaveBeenCalledTimes(1);
		expect(applicationMocks.ideasStop).toHaveBeenCalledTimes(1);
		expect(applicationMocks.libraryStop).toHaveBeenCalledTimes(1);

		await application.StartAsync();
		expect(applicationMocks.libraryStart).toHaveBeenCalledTimes(2);
		expect(applicationMocks.lookupRegister).toHaveBeenCalledTimes(2);
		expect(applicationMocks.ideasStart).toHaveBeenCalledTimes(2);
		expect(applicationMocks.dreamsStart).toHaveBeenCalledTimes(2);

		application.Stop();
		application.Stop();
		expect(applicationMocks.lookupUnregister).toHaveBeenCalledTimes(2);
		expect(applicationMocks.dreamsStop).toHaveBeenCalledTimes(2);
		expect(applicationMocks.ideasStop).toHaveBeenCalledTimes(2);
		expect(applicationMocks.libraryStop).toHaveBeenCalledTimes(2);
	});
});
