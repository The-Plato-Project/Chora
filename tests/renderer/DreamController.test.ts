import { DreamSaveCoordinator } from "../../src/renderer/dreams/DreamSaveCoordinator.js";
import { DreamCatalogueController } from "../../src/renderer/dreams/DreamCatalogueController.js";
import { DreamExportController } from "../../src/renderer/dreams/DreamExportController.js";
import { DreamExplorerController } from "../../src/renderer/workspace/DreamExplorerController.js";
import type { OperationResult } from "../../src/shared/diagnostics/OperationResult.js";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { UpdateDreamCommand } from "../../src/shared/dreams/DreamTypes.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { TextDocument } from "../../src/shared/library/LibraryTypes.js";

// Canonical test document.
const document = TextDocument.FromSnapshot({
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: null,
	author: "Plato",
	language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "abcdef" },
		{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: "ghijkl" }
	]
});

// Creates one canonical Dream aggregate.
function CreateDream(): DreamView
{
	return {
		id: "dream-1",
		workId: "republic",
		dialogue: "Republic",
		title: "",
		source: { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 } },
		signals: [],
		reflection: "",
		linkedDreamIds: [],
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};
}

describe("DreamController", function DreamControllerTests()
{
	let events: ChoraEventBus<ChoraEvents>;
	let store: DreamStore;
	let library: LibraryStore;
	let controller: DreamController;
	let saves: DreamSaveCoordinator;
	let catalogueController: DreamCatalogueController;
	let explorer: DreamExplorerController;
	let catalogue: DreamView[];

	beforeEach(function Setup(): void
	{
		vi.useFakeTimers();
		window.sessionStorage.clear();
		catalogue = [];
		events = new ChoraEventBus<ChoraEvents>();
		store = new DreamStore(new SessionStore());
		library = new LibraryStore();
		library.Open(document, null);
		vi.stubGlobal("window", {
			...window,
			sessionStorage: window.sessionStorage,
			chora: {
				CreateDream: vi.fn(async function CreateDreamAsync(): Promise<OperationResult<DreamView>>
				{
					const dream = CreateDream();
					catalogue = [dream];
					return { ok: true, value: structuredClone(dream) };
				}),
				UpdateDream: vi.fn(async function UpdateDreamAsync(command: UpdateDreamCommand): Promise<OperationResult<DreamView>>
				{
					const current = catalogue[0] ?? CreateDream();
					const dream: DreamView = {
						...current,
						title: command.title,
						source: structuredClone(command.source),
						reflection: command.reflection,
						linkedDreamIds: [...command.linkedDreamIds]
					};
					catalogue = [structuredClone(dream)];
					return { ok: true, value: structuredClone(dream) };
				}),
				DeleteDream: vi.fn(async function DeleteDreamAsync(): Promise<OperationResult<void>>
				{
					catalogue = [];
					return { ok: true, value: undefined };
				}),
				ListDreamCatalogue: vi.fn(async function ListDreamCatalogueAsync()
				{
					return { ok: true as const, value: { dreams: structuredClone(catalogue), folders: [], locations: catalogue.map(function CreateLocation(dream)
					{
						return { dreamId: dream.id, workId: dream.workId, folderPath: "" };
					}) } };
				}),
				CreateDreamFolder: vi.fn(),
				DeleteDreamFolder: vi.fn(),
				MoveDream: vi.fn(),
				ShowDreamSourceContextMenu: vi.fn().mockResolvedValue({ ok: true, value: "lookup" }),
				CopySelectedText: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
				LookUpWord: vi.fn().mockResolvedValue({ ok: true, value: undefined })
			}
		});
		const errors = new ErrorManager(events);
		const gateway = new DreamGateway();
		saves = new DreamSaveCoordinator(events, errors, store, gateway);
		catalogueController = new DreamCatalogueController(events, errors, library, store, gateway, saves);
		explorer = new DreamExplorerController(store, library, gateway, events, errors, catalogueController, { HasUncommittedChanges: function HasUncommittedChanges(): boolean { return false; } });
		controller = new DreamController(events, errors, library, store, gateway, new LibraryGateway(), saves);
	});

	afterEach(function Cleanup(): void
	{
		explorer.Dispose();
		catalogueController.Dispose();
		controller.Dispose();
		saves.Dispose();
		store.Dispose();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("creates Dreams through one canonical API", async function CreatesDreamAsync(): Promise<void>
	{
		const selection = CreateDream().source;

		await explorer.CreateDreamAsync(selection);

		expect(window.chora.CreateDream).toHaveBeenCalledExactlyOnceWith({
			workId: "republic",
			dialogue: "Republic",
			source: selection,
			folderPath: ""
		});
		expect(store.GetActiveDream()?.id).toBe("dream-1");
		expect(store.GetIsDirty()).toBe(false);
		expect(window.chora.ListDreamCatalogue).not.toHaveBeenCalled();
	});

	it("updates Dreams through the update API", async function UpdatesDreamAsync(): Promise<void>
	{
		await explorer.CreateDreamAsync(CreateDream().source);
		controller.UpdateTitle("Attention");

		await saves.SaveAsync();

		expect(window.chora.UpdateDream).toHaveBeenCalledWith(expect.objectContaining({
			dreamId: "dream-1",
			title: "Attention"
		}));
		expect(window.chora.UpdateDream).not.toHaveBeenCalledWith(expect.objectContaining({
			signals: expect.anything()
		}));
		expect(window.chora.ListDreamCatalogue).not.toHaveBeenCalled();
	});

	it("shares one catalogue read across concurrent refresh requests", async function SharesRefreshAsync(): Promise<void>
	{
		catalogue = [CreateDream()];

		await Promise.all([
			catalogueController.RefreshAsync(),
			catalogueController.RefreshAsync(),
			catalogueController.RefreshAsync()
		]);

		expect(window.chora.ListDreamCatalogue).toHaveBeenCalledOnce();
		expect(store.GetCatalogue()).toHaveLength(1);
	});

	it("moves every selected Dream through the canonical move API", async function MovesSelectedDreamsAsync(): Promise<void>
	{
		const first = CreateDream();
		const second = { ...CreateDream(), id: "dream-2" };
		store.SetCatalogue(
			[first, second],
			[{ workId: "republic", path: "Themes", name: "Themes", parentPath: "" }],
			[
				{ dreamId: first.id, workId: first.workId, folderPath: "" },
				{ dreamId: second.id, workId: second.workId, folderPath: "" }
			]);
		vi.mocked(window.chora.MoveDream).mockImplementation(async function MoveDreamAsync(command)
		{
			return { ok: true as const, value: { dreamId: command.dreamId, workId: "republic", folderPath: command.folderPath } };
		});

		const moved = await explorer.MoveDreamsAsync([first.id, second.id], "Themes");

		expect(moved).toBe(true);
		expect(window.chora.MoveDream).toHaveBeenCalledTimes(2);
		expect(store.GetDreamFolder(first.id)).toBe("Themes");
		expect(store.GetDreamFolder(second.id)).toBe("Themes");
	});

	it("opens Dreams without opening text, scrolling, or highlighting selections", async function OpensWithoutNavigationAsync(): Promise<void>
	{
		catalogue = [CreateDream()];
		await catalogueController.RefreshAsync();
		let textRequests = 0;
		let jumpRequests = 0;
		events.Subscribe("library.text-open-requested", function CountTextRequest(): void
		{
			textRequests += 1;
		});
		events.Subscribe("library.jump-requested", function CountJumpRequest(): void
		{
			jumpRequests += 1;
		});

		controller.Open("dream-1");
		await Promise.resolve();

		expect(store.GetActiveDream()?.id).toBe("dream-1");
		expect(textRequests).toBe(0);
		expect(jumpRequests).toBe(0);
	});

	it("extends a Dream source without automatically jumping", async function ExtendsWithoutNavigationAsync(): Promise<void>
	{
		await explorer.CreateDreamAsync(CreateDream().source);
		let jumps = 0;
		events.Subscribe("library.jump-requested", function CountJump(): void
		{
			jumps += 1;
		});
		const extension = { documentId: "republic", start: { segmentKey: "s2", offset: 0 }, end: { segmentKey: "s2", offset: 3 } };

		await controller.ExtendSourceAsync(extension);

		expect(store.GetActiveDream()?.source.end).toEqual(extension.end);
		expect(jumps).toBe(0);
	});

	it("routes Dream-source Signal creation through the shared request", async function RoutesSignalCreationAsync(): Promise<void>
	{
		await explorer.CreateDreamAsync(CreateDream().source);
		vi.mocked(window.chora.ShowDreamSourceContextMenu).mockResolvedValueOnce({ ok: true, value: "add-dream-source-signal" });
		let requested = false;
		events.Subscribe("dream.signal-add-requested", function CaptureRequest(): void
		{
			requested = true;
		});

		await controller.HandleTextSelectionAsync({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 3 } });

		expect(requested).toBe(true);
	});

	it("deletes the active Dream through the one Dream API", async function DeletesDreamAsync(): Promise<void>
	{
		await explorer.CreateDreamAsync(CreateDream().source);

		const deleted = await controller.DeleteAsync();

		expect(deleted).toBe(true);
		expect(window.chora.DeleteDream).toHaveBeenCalledExactlyOnceWith("dream-1");
		expect(store.GetActiveDream()).toBeNull();
		expect(window.chora.ListDreamCatalogue).not.toHaveBeenCalled();
	});

	it("retains the active Dream when deletion fails", async function RetainsFailedDeletionAsync(): Promise<void>
	{
		await explorer.CreateDreamAsync(CreateDream().source);
		vi.mocked(window.chora.DeleteDream).mockRejectedValueOnce(new Error("Disk unavailable"));

		const deleted = await controller.DeleteAsync();

		expect(deleted).toBe(false);
		expect(store.GetActiveDream()?.id).toBe("dream-1");
		expect(store.GetCatalogue()).toHaveLength(1);
	});
});
