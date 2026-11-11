// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationState } from "../../src/renderer/app/ApplicationState.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { LibraryController } from "../../src/renderer/library/LibraryController.js";
import type { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { WordExplorationStore } from "../../src/renderer/library/words/WordExplorationStore.js";
import { WordExplorationController } from "../../src/renderer/library/words/WordExplorationController.js";
import type { WordExplorationGateway } from "../../src/renderer/library/words/WordExplorationGateway.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import { VisionController } from "../../src/renderer/visions/VisionController.js";
import type { VisionGateway } from "../../src/renderer/visions/VisionGateway.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

const storageKey = "chora:application-state";
const vision = { id: "vision-1", workId: "republic", folderPath: "", title: "Writing", markdown: "Authoritative writing",
	createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z" };
const text = TextDocument.FromSnapshot({ id: "republic", textVersion: `sha256:${"0".repeat(64)}`, urn: null,
	title: "Republic", titleGreek: null, author: "Plato", language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
	segments: [{ key: "first", citation: { system: "stephanus", value: "327a" }, text: "abcdef" }] });
const selection = text.CreateSelection({ stephanus: "first", offset: 0 }, { stephanus: "first", offset: 3 });
const occurrence = text.CreateSelection({ stephanus: "first", offset: 3 }, { stephanus: "first", offset: 6 });
const disposables: Array<{ Dispose(): void }> = [];

function CreateApplicationState()
{
	const events = new ChoraEventBus<ChoraEvents>();
	const errors = new ErrorManager(events);
	const libraryStore = new LibraryStore();
	const visionStore = new VisionStore();
	const wordStore = new WordExplorationStore();
	const libraryGateway = { ListAsync: vi.fn().mockResolvedValue([text]), LoadAsync: vi.fn().mockResolvedValue(text),
		GetSourceNoticeAsync: vi.fn().mockResolvedValue(null) };
	const visionGateway = { ListAsync: vi.fn().mockResolvedValue({ visions: [vision], folders: [] }) };
	const evidence = { selection, possibilities: [{ lemma: "first", candidates: [] }, { lemma: "second", candidates: [] }], lemmas: [] };
	const wordGateway = { GetEvidenceAsync: vi.fn().mockResolvedValue(evidence),
		GetLexicalEvidenceAsync: vi.fn().mockResolvedValue({ ...evidence, selection: null }) };
	const library = new LibraryController(events, errors, libraryStore, libraryGateway as unknown as LibraryGateway);
	const visions = new VisionController(events, errors, visionStore, visionGateway as unknown as VisionGateway);
	const words = new WordExplorationController(events, errors, libraryStore, library, wordStore, wordGateway as unknown as WordExplorationGateway);
	const state = new ApplicationState(events, errors, libraryStore, library, visionStore, visions, wordStore, words);
	disposables.push(words, visions, state);
	return { state, events, library, libraryStore, visionStore, wordStore, wordGateway, visionGateway };
}

beforeEach(function ClearStorage(): void
{
	window.localStorage.clear();
	window.sessionStorage.clear();
});

afterEach(function DisposeApplications(): void
{
	for (const disposable of disposables.reverse()) disposable.Dispose();
	disposables.length = 0;
	vi.restoreAllMocks();
});

// These replace the three storage tests belonging to the removed session-only owner.
describe("ApplicationState", function ApplicationStateTests()
{
	it("round trips durable workspace metadata across application instances", async function RoundTripsValuesAsync(): Promise<void>
	{
		const first = CreateApplicationState();
		await first.state.RestoreAsync();
		first.visionStore.Open(vision.id);
		first.visionStore.SetEditorMode(vision.id, "markdown");
		first.library.SetSelection(selection);
		const firstId = first.wordStore.RestoreTab({ selection, lemma: "first", occurrence }, "abc");
		first.wordStore.RestoreTab({ selection, lemma: "second", occurrence: null }, "abc");
		first.wordStore.OpenLemma("πρός");
		first.wordStore.SelectTab(firstId);
		first.wordStore.SetVisible(false);
		first.state.Save();
		const saved = window.localStorage.getItem(storageKey)!;
		expect(saved).not.toContain("Authoritative writing");
		expect(saved).not.toContain("possibilities");
		first.state.Dispose();
		window.sessionStorage.clear();

		const second = CreateApplicationState();
		await second.state.RestoreAsync();
		expect(second.visionStore.GetTabsState()).toEqual(first.visionStore.GetTabsState());
		expect(second.libraryStore.GetSelection()).toEqual(selection);
		expect(second.wordStore.GetWorkspaceState()).toEqual(first.wordStore.GetWorkspaceState());
		expect(second.wordGateway.GetEvidenceAsync).toHaveBeenCalledTimes(2);
		// A failed catalogue read preserves last-good tab identities for a later retry.
		second.state.Dispose();
		const unavailable = CreateApplicationState();
		unavailable.visionGateway.ListAsync.mockRejectedValue(new Error("offline"));
		await unavailable.state.RestoreAsync();
		expect(JSON.parse(window.localStorage.getItem(storageKey)!).visions.openVisionIds).toEqual([vision.id]);
	});

	it("tolerates corrupt JSON and rejects malformed or stale resume selections", async function RemovesCorruptValuesAsync(): Promise<void>
	{
		window.localStorage.setItem(storageKey, "{broken");
		const empty = CreateApplicationState();
		await empty.state.RestoreAsync();
		expect(empty.wordStore.GetTabs()).toEqual([]);
		empty.state.Dispose();
		window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, workId: "republic",
			selection: { ...selection, text_version: `sha256:${"1".repeat(64)}` }, focus: "broken",
			visions: { openVisionIds: [vision.id, "deleted", vision.id, 123], activeVisionId: "deleted" },
			words: { tabs: [{ selection: "broken" }, { selection: { ...selection, dialogue: "missing" } },
				{ selection, lemma: "unavailable" }], activeIndex: 2, visible: true } }));
		const restored = CreateApplicationState();
		await restored.state.RestoreAsync();
		expect(restored.visionStore.GetOpenTabs().map(function GetId(tab) { return tab.visionId; })).toEqual([vision.id]);
		expect(restored.libraryStore.GetSelection()).toBeNull();
		expect(restored.wordStore.GetTabs()).toHaveLength(1);
		// An unavailable saved lemma must return to the reader's chooser.
		expect(restored.wordStore.GetSnapshot().selectedLemma).toBeNull();
	});

	it("migrates legacy metadata and checkpoints explicitly closed tabs on shutdown", async function RemovesValuesAsync(): Promise<void>
	{
		window.localStorage.setItem("chora:last-work", "republic");
		window.sessionStorage.setItem("chora:vision-session", JSON.stringify({ openVisionIds: [vision.id], activeVisionId: vision.id }));
		const first = CreateApplicationState();
		await first.state.RestoreAsync();
		expect(first.visionStore.GetActive()?.id).toBe(vision.id);
		expect(window.sessionStorage.getItem("chora:vision-session")).toBeNull();
		expect(window.localStorage.getItem("chora:last-work")).toBeNull();
		first.visionStore.Close(vision.id);
		first.wordStore.Clear();
		window.dispatchEvent(new Event("pagehide"));
		first.state.Dispose();
		const second = CreateApplicationState();
		const positioned = vi.fn();
		const jumped = vi.fn();
		second.events.Subscribe("library.position-restored", positioned);
		second.events.Subscribe("library.jump-requested", jumped);
		await second.state.RestoreAsync();
		expect(second.visionStore.GetActive()).toBeNull();
		expect(second.wordStore.GetTabs()).toEqual([]);
		expect(positioned).toHaveBeenCalledWith({ segmentKey: "first" });
		expect(jumped).not.toHaveBeenCalled();
	});
});
