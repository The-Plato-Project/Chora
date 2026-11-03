import { DreamSaveCoordinator } from "../../src/renderer/dreams/DreamSaveCoordinator.js";
import { DreamCatalogueController } from "../../src/renderer/dreams/DreamCatalogueController.js";
import { DreamExportController } from "../../src/renderer/dreams/DreamExportController.js";
import { DreamExplorerController } from "../../src/renderer/workspace/DreamExplorerController.js";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import type { TextDocument } from "../../src/shared/library/LibraryTypes.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import { DreamPanel } from "../../src/renderer/dreams/DreamPanel.js";
import { DreamPassagePanel } from "../../src/renderer/dreams/DreamPassagePanel.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { LibraryController } from "../../src/renderer/library/LibraryController.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { DocumentPanel } from "../../src/renderer/library/DocumentPanel.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ReadingSettingsStore } from "../../src/renderer/core/settings/ReadingSettingsStore.js";
import { DocumentIcon } from "../../src/renderer/ui/Icons.js";

// A passage split across segments followed by two further passages.
const text: TextDocument = {
	id: "republic", textVersion: `sha256:${"0".repeat(64)}`, title: "Republic", urn: null, titleGreek: null, author: "Plato", language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "340a" }, division: { type: "book", label: "1" }, text: "abcdef" },
		{ key: "s2", citation: { system: "stephanus", value: "340a" }, division: { type: "book", label: "1" }, text: "ghijkl" },
		{ key: "s3", citation: { system: "stephanus", value: "340b" }, division: { type: "book", label: "1" }, text: "mnopqr" },
		{ key: "s4", citation: { system: "stephanus", value: "341c" }, division: { type: "book", label: "1" }, text: "stuvwx" }
	]
};

// Creates a DreamView spanning all three passages without any signals.
function CreateDream(): DreamView
{
	const dream: DreamView = {
		id: "dream", workId: text.id, dialogue: text.title, title: "Attention", signals: [], reflection: "",
		linkedDreamIds: [], createdAt: "2026-09-07", updatedAt: "2026-09-07",
		source: {
			dialogue: text.id, text_version: `sha256:${"0".repeat(64)}`, start: { stephanus: "s1", offset: 1 }, end: { stephanus: "s4", offset: 3 }
		}
	};
	return dream;
}

describe("Dream passage matching", function PassageTests()
{
	afterEach(function Cleanup(): void
	{
		window.sessionStorage.clear();
	});

	it("keeps search and reading controls in the reader with visible source attribution", async function UsesReaderControlsAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		const documentText = structuredClone(text);
		documentText.titleGreek = "Greek title";
		documentText.segments[0].text = "word word";
		for (const segment of documentText.segments)
		{
			segment.division = { type: "book", label: segment.key === "s4" ? "2" : "1" };
		}
		library.Open(documentText, {
			source: "Perseus Digital Library", license: "CC BY-SA", editor: null, editionTitle: null, repository: "test"
		});
		const dreamStore = new DreamStore(new SessionStore());
		const controller = new LibraryController(events, errors, library, new LibraryGateway(), dreamStore);
		const root = document.createElement("div");
		root.className = "shell";
		const stylesheet = document.createElement("style");
		const baseStyles = readFileSync("src/renderer/styles/base.css", "utf8");
		const workspaceStyles = readFileSync("src/renderer/styles/workspace-theme.css", "utf8");
		stylesheet.textContent = `${baseStyles}\n${workspaceStyles}`;
		document.head.append(stylesheet);
		document.body.append(root);
		const panel = new DocumentPanel(root, events, library, controller, new ReadingSettingsStore());
		try
		{
			await events.PublishAsync("library.text-opened", {});
			expect(root.querySelector("[data-reader-work]")).toBeNull();
			expect(root.querySelector(".work-header-greek")).toBeNull();
			const headings = Array.from(root.querySelectorAll<HTMLElement>(".book-heading"));
			expect(headings.map(function HeadingText(heading): string { return heading.textContent ?? ""; })).toEqual(["Book I", "Book II"]);
			for (const heading of headings)
			{
				expect(getComputedStyle(heading).display).toBe("block");
				expect(heading.nextElementSibling?.getAttribute("data-book-start")).toBe(heading.dataset.bookHeading);
			}
			expect(root.querySelector(".reader-source-attribution")?.textContent).toBe("Perseus Digital Library · CC BY-SA");
			expect(root.querySelector(".reader-toolbar .reader-source-attribution")).toBeNull();
			expect(root.querySelectorAll(".reader-toolbar details")).toHaveLength(2);
			expect(root.querySelectorAll(".reader-settings-popover [data-font-size]")).toHaveLength(2);
			expect(root.querySelector(".reader-search-menu > summary")?.getAttribute("aria-label")).toBe("Find in text");
			expect(root.querySelector(".reader-settings-menu > summary")?.getAttribute("aria-label")).toBe("Reading settings");
			const navigation = root.querySelector(".reader-passage-navigation")!;
			expect(navigation.querySelector("[data-reader-work]")).toBeNull();
			expect(navigation.querySelector("[data-book-navigation]")).not.toBeNull();
			expect(navigation.querySelector("[data-locator-navigation]")).not.toBeNull();
			expect(navigation.querySelector("[data-locator-jump]")).toBeNull();
			expect(root.querySelector(".reader-toolbar-line [data-book-navigation]")).not.toBeNull();
			const passageSelect = root.querySelector<HTMLSelectElement>("[data-locator-navigation]")!;
			const labels = Array.from(passageSelect.options).map(function GetLabel(option): string { return option.text; });
			expect(labels).toEqual(["340a", "340b", "341c"]);
			expect(passageSelect.value).toBe("340a");
			const firstPassage = root.querySelector<HTMLElement>("[data-locator='340a']")!;
			expect(getComputedStyle(firstPassage).getPropertyValue("content-visibility")).not.toBe("auto");
			passageSelect.value = "341c";
			passageSelect.dispatchEvent(new Event("change", { bubbles: true }));
			expect(passageSelect.value).toBe("341c");
			passageSelect.value = "340a";
			passageSelect.dispatchEvent(new Event("change", { bubbles: true }));
			const searchMenu = root.querySelector<HTMLDetailsElement>(".reader-search-menu")!;
			searchMenu.open = true;
			const input = root.querySelector<HTMLInputElement>("[data-find-input]")!;
			input.value = "word";
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			expect(root.querySelectorAll("mark.find-hit")).toHaveLength(2);
			expect(root.querySelector("[data-find-count]")?.textContent).toBe("1/2");
			root.querySelector<HTMLButtonElement>("[data-find-next]")?.click();
			expect(root.querySelector("[data-find-count]")?.textContent).toBe("2/2");
			root.querySelector<HTMLButtonElement>("[data-find-prev]")?.click();
			expect(root.querySelector("[data-find-count]")?.textContent).toBe("1/2");
			input.value = "";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			expect(root.querySelectorAll("mark.find-hit")).toHaveLength(0);
			expect(root.querySelector("[data-find-count]")?.textContent).toBe("");
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			expect(searchMenu.open).toBe(false);
			root.querySelector<HTMLButtonElement>('[data-passage-step="1"]')?.click();
			expect(passageSelect.value).toBe("340b");
			root.querySelector<HTMLButtonElement>('[data-passage-step="-1"]')?.click();
			expect(passageSelect.value).toBe("340a");
			const book = root.querySelector<HTMLSelectElement>("[data-book-navigation]")!;
			const headingBounds = vi.spyOn(headings[1], "getBoundingClientRect").mockReturnValue(new DOMRect(0, 500, 400, 30));
			const toolbar = root.querySelector<HTMLElement>(".reader-toolbar")!;
			const toolbarBounds = vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 100));
			root.scrollTop = 0;
			book.value = "2";
			book.dispatchEvent(new Event("change", { bubbles: true }));
			expect(root.scrollTop).toBe(384);
			expect(passageSelect.value).toBe("341c");
			headingBounds.mockRestore();
			toolbarBounds.mockRestore();
			await events.PublishAsync("library.focus-changed", { textId: text.id, segmentKey: "s2" });
			expect(passageSelect.value).toBe("340a");
			expect(book.value).toBe("1");
			await events.PublishAsync("library.focus-changed", { textId: text.id, segmentKey: "s4" });
			expect(passageSelect.value).toBe("341c");
			vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 600));
			vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 100));
			const positions: Record<string, number> = { s1: 120, s2: 220, s3: 320, s4: 800 };
			for (const segment of Array.from(root.querySelectorAll<HTMLElement>("[data-segment-key]")))
			{
				vi.spyOn(segment, "getBoundingClientRect").mockImplementation(function SegmentBounds(): DOMRect
				{
					const top = positions[segment.dataset.segmentKey!];
					return new DOMRect(0, top, 400, 100);
				});
			}
			root.dispatchEvent(new Event("scroll"));
			await vi.waitFor(function BookStartUpdated(): void
			{
				expect(passageSelect.value).toBe("340a");
			});
			positions.s1 = -100;
			positions.s2 = 0;
			positions.s3 = 100;
			positions.s4 = 260;
			root.dispatchEvent(new Event("scroll"));
			await vi.waitFor(function ScrollUpdated(): void
			{
				expect(passageSelect.value).toBe("340b");
				expect(book.value).toBe("1");
			});
			root.scrollTop = 0;
			positions.s1 = 500;
			passageSelect.value = "340a";
			passageSelect.dispatchEvent(new Event("change", { bubbles: true }));
			expect(root.scrollTop).toBe(384);
		}
		finally
		{
			panel.Dispose();
			root.remove();
			stylesheet.remove();
		}
	});

	it("counts source overlap once per passage, including intermediate passages and excluding other works", function MatchesAnchors(): void
	{
		const sessions = new SessionStore();
		const store = new DreamStore(sessions);
		const dream = CreateDream();
		const other = CreateDream();
		other.id = "other";
		other.workId = "other-work";
		store.SetCatalogue([dream, other], [], [
			{ dreamId: dream.id, workId: dream.workId, folderPath: "" },
			{ dreamId: other.id, workId: other.workId, folderPath: "" }
		]);
		const counts = store.GetPassageCounts(text);
		expect([...counts]).toEqual([["s1", 1], ["s3", 1], ["s4", 1]]);
		expect([...store.GetPassageDreamTitles(text)]).toEqual([
			["s1", ["Attention"]],
			["s3", ["Attention"]],
			["s4", ["Attention"]]
		]);
		store.SetPassageFilter({ workId: text.id, segmentKey: "s3", label: "Republic · 340b" });
		expect(store.GetVisibleCatalogue("", text)).toEqual([dream]);
		expect(store.GetVisibleCatalogue("attention", text)).toEqual([dream]);
		expect(store.GetVisibleCatalogue("missing", text)).toEqual([]);
		store.SetPassageFilter(null);
		expect(store.GetVisibleCatalogue("")).toHaveLength(2);
		expect(store.GetVisibleCatalogue("", text)).toEqual([dream]);
	});

	it("refreshes work-scoped Dreams when another text is requested", async function SwitchesWorkAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		const otherText = structuredClone(text);
		otherText.id = "phaedo";
		otherText.title = "Phaedo";
		library.SetLibrary([text, otherText].map(function Summarize(work)
		{
			return { ...work, editor: null };
		}));
		library.Open(text, null);
		const store = new DreamStore(new SessionStore());
		const dream = CreateDream();
		const otherDream = CreateDream();
		otherDream.id = "other-dream";
		otherDream.workId = otherText.id;
		otherDream.dialogue = otherText.title;
		otherDream.source.dialogue = otherText.id;
		store.SetCatalogue([dream], [], [{ dreamId: dream.id, workId: dream.workId, folderPath: "" }]);
		store.Open(dream, false);
		const gateway = new DreamGateway();
		const list = vi.spyOn(gateway, "ListAsync").mockResolvedValue({
			dreams: [dream, otherDream],
			folders: [],
			locations: [
				{ dreamId: dream.id, workId: dream.workId, folderPath: "" },
				{ dreamId: otherDream.id, workId: otherDream.workId, folderPath: "" }
			]
		});
		const libraryGateway = new LibraryGateway();
		const saveOwner = new DreamSaveCoordinator(events, errors, store, gateway);
		const catalogueOwner = new DreamCatalogueController(events, errors, library, store, gateway, saveOwner);
		const explorerOwner = new DreamExplorerController(store, library, gateway, events, errors, catalogueOwner, { HasUncommittedChanges: function HasUncommittedChanges(): boolean { return false; } });
		const exportOwner = new DreamExportController(store, library, libraryGateway);
		const dreams = new DreamController(events, errors, library, store, gateway, libraryGateway, saveOwner);
		vi.spyOn(libraryGateway, "LoadAsync").mockResolvedValue(otherText);
		vi.spyOn(libraryGateway, "GetSourceNoticeAsync").mockResolvedValue(null);
		const controller = new LibraryController(events, errors, library, libraryGateway, store);
		const readingRoot = document.createElement("div");
		const catalogueRoot = document.createElement("div");
		document.body.append(readingRoot, catalogueRoot);
		const reader = new DocumentPanel(readingRoot, events, library, controller, new ReadingSettingsStore());
		const catalogue = new DreamPanel(catalogueRoot, events, store, dreams, library, "catalogue", catalogueOwner, saveOwner, exportOwner, explorerOwner);
		try
		{
			await events.PublishAsync("library.text-opened", {});
			expect(readingRoot.querySelector("[data-reader-work]")).toBeNull();
			expect(catalogueRoot.querySelectorAll("[data-dream-id]")).toHaveLength(1);
			store.SetSearchText("old query");
			store.SetPassageFilter({ workId: text.id, segmentKey: "s1", label: "Republic" });
			list.mockClear();
			await events.PublishAsync("library.text-open-requested", { textId: otherText.id });
			await vi.waitFor(function WorkRendered(): void
			{
				expect(library.GetText()?.id).toBe("phaedo");
				expect(catalogueRoot.querySelector("[data-dream-id]")?.getAttribute("data-dream-id")).toBe(otherDream.id);
			});
			expect(list).toHaveBeenCalledOnce();
			expect(store.GetSearchText()).toBe("");
			expect(store.GetPassageFilter()).toBeNull();
			expect(store.GetActiveDream()?.id).toBe(dream.id);
			list.mockResolvedValue({
				dreams: [dream],
				folders: [],
				locations: [{ dreamId: dream.id, workId: dream.workId, folderPath: "" }]
			});
			library.Open(otherText, null);
			await events.PublishAsync("library.text-opened", {});
			expect(catalogueRoot.querySelectorAll("[data-dream-id]")).toHaveLength(0);
		}
		finally
		{
			reader.Dispose();
			catalogue.Dispose();
			explorerOwner.Dispose();
			catalogueOwner.Dispose();
			saveOwner.Dispose();
			store.Dispose();
			readingRoot.remove();
			catalogueRoot.remove();
			window.localStorage.removeItem("chora:last-work");
		}
	});

	it("excludes zero-width end overlap and unresolved anchors", function HandlesBoundaries(): void
	{
		const sessions = new SessionStore();
		const store = new DreamStore(sessions);
		const dream = CreateDream();
		dream.source.end.offset = 0;
		store.SetCatalogue([dream], [], [{ dreamId: dream.id, workId: dream.workId, folderPath: "" }]);
		expect([...store.GetPassageCounts(text)]).toEqual([["s1", 1], ["s3", 1]]);
		dream.source.start.stephanus = "missing";
		store.SetCatalogue([dream], [], [{ dreamId: dream.id, workId: dream.workId, folderPath: "" }]);
		expect(store.GetPassageCounts(text).size).toBe(0);
	});

	it("filters from a passage icon, shows full ranges, clears search, and preserves the reading DOM", async function FiltersFromReadingAsync(): Promise<void>
	{
		const sessions = new SessionStore();
		const store = new DreamStore(sessions);
		const dream = CreateDream();
		const single = CreateDream();
		single.id = "single";
		single.source.end = { stephanus: "s1", offset: 4 };
		store.SetCatalogue([dream, single], [], [
			{ dreamId: dream.id, workId: dream.workId, folderPath: "" },
			{ dreamId: single.id, workId: single.workId, folderPath: "" }
		]);
		store.SetSearchText("old query");
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const failure = vi.fn();
		events.SetErrorHandler(failure);
		const library = new LibraryStore();
		library.Open(text, null);
		const gateway = new DreamGateway();
		vi.spyOn(gateway, "ListAsync").mockImplementation(async function ListDreamCatalogueAsync()
		{
			const catalogue = store.GetCatalogue();
			return {
				dreams: [...catalogue],
				folders: [],
				locations: catalogue.map(function CreateLocation(candidate)
				{
					return { dreamId: candidate.id, workId: candidate.workId, folderPath: "" };
				})
			};
		});
		const libraryGateway = new LibraryGateway();
		const saveOwner = new DreamSaveCoordinator(events, errors, store, gateway);
		const catalogueOwner = new DreamCatalogueController(events, errors, library, store, gateway, saveOwner);
		const explorerOwner = new DreamExplorerController(store, library, gateway, events, errors, catalogueOwner, { HasUncommittedChanges: function HasUncommittedChanges(): boolean { return false; } });
		const exportOwner = new DreamExportController(store, library, libraryGateway);
		const controller = new DreamController(events, errors, library, store, gateway, libraryGateway, saveOwner);
		const libraryController = new LibraryController(events, errors, library, libraryGateway, store);
		const readingRoot = document.createElement("div");
		const catalogueRoot = document.createElement("div");
		document.body.append(readingRoot, catalogueRoot);
		const documentPanel = new DocumentPanel(readingRoot, events, library, libraryController, new ReadingSettingsStore());
		const passagePanel = new DreamPassagePanel(readingRoot, events, library, catalogueOwner);
		const cataloguePanel = new DreamPanel(catalogueRoot, events, store, controller, library, "catalogue", catalogueOwner, saveOwner, exportOwner, explorerOwner);
		try
		{
			await events.PublishAsync("library.text-opened", {});
			const sourceNode = readingRoot.querySelector(".segment-text");
			expect(catalogueRoot.querySelector(".catalogue-header")).toBeNull();
			expect(catalogueRoot.querySelector(".dream-catalogue-controls [data-new-dream]")).not.toBeNull();
			expect(catalogueRoot.querySelector(".dream-catalogue-controls [data-dream-search]")).not.toBeNull();
			expect(catalogueRoot.querySelector("[data-text-toggle]")?.textContent).toContain("The Republic");
			expect(catalogueRoot.querySelector("[data-text-toggle]")?.getAttribute("aria-level")).toBe("1");
			expect(catalogueRoot.querySelector("[data-book-toggle]")?.getAttribute("aria-level")).toBe("2");
			expect(catalogueRoot.querySelector("[data-dream-id]")?.getAttribute("aria-level")).toBe("3");
			readingRoot.scrollTop = 120;
			const button = readingRoot.querySelector<HTMLButtonElement>('[data-passage-dreams="s3"]');
			expect(button?.getAttribute("aria-label")).toBe("1 Dream for 340b:\nAttention");
			expect(button?.title).toBe("1 Dream for 340b:\nAttention");
			expect(button?.innerHTML).toBe(DocumentIcon);
			button?.click();
			await vi.waitFor(function FilterRendered(): void
			{
				expect(catalogueRoot.querySelector(".dream-passage-filter")?.textContent).toContain("Republic · 340b");
			});
			expect(store.GetSearchText()).toBe("");
			expect(catalogueRoot.querySelectorAll("[data-dream-id]")).toHaveLength(1);
			expect(catalogueRoot.querySelector("[data-dream-id]")?.getAttribute("title")).toBe("Republic · 340a–341c");
			expect(catalogueRoot.querySelector("[data-dream-id] .catalogue-reference")?.textContent).toBe("(340a–341c)");
			expect(readingRoot.querySelector(".segment-text")).toBe(sourceNode);
			expect(readingRoot.scrollTop).toBe(120);
			expect(store.GetActiveDream()).toBeNull();

			const clear = catalogueRoot.querySelector<HTMLButtonElement>("[data-clear-passage-filter]");
			clear?.click();
			await vi.waitFor(function FilterCleared(): void
			{
				expect(catalogueRoot.querySelectorAll("[data-dream-id]")).toHaveLength(2);
			});
			const singleLocation = catalogueRoot.querySelector('[data-dream-id="single"]');
			expect(singleLocation?.getAttribute("title")).toBe("Republic · 340a");

			await events.PublishAsync("dream.passage-filter-requested", { workId: text.id, segmentKey: "s3" });
			store.SetCatalogue([single], [], [{ dreamId: single.id, workId: single.workId, folderPath: "" }]);
			await events.PublishAsync("dream.saved", {});
			expect(readingRoot.querySelector('[data-passage-dreams="s3"]')).toBeNull();
			expect(catalogueRoot.querySelector(".dream-empty")?.textContent).toBe("No matching Dreams.");
			expect(readingRoot.querySelector(".segment-text")).toBe(sourceNode);
			expect(readingRoot.scrollTop).toBe(120);

			const otherText = structuredClone(text);
			otherText.id = "other-work";
			library.Open(otherText, null);
			await events.PublishAsync("library.text-opened", {});
			expect(store.GetPassageFilter()).toBeNull();
			expect(readingRoot.querySelector("[data-passage-dreams]")).toBeNull();
			expect(failure).not.toHaveBeenCalled();
		}
		finally
		{
			passagePanel.Dispose();
			documentPanel.Dispose();
			cataloguePanel.Dispose();
			explorerOwner.Dispose();
			catalogueOwner.Dispose();
			saveOwner.Dispose();
			store.Dispose();
			readingRoot.remove();
			catalogueRoot.remove();
		}
	});
});
