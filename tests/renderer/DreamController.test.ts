import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { TextDocument } from "../../src/shared/library/LibraryTypes.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";
import { SignalStore } from "../../src/renderer/signals/SignalStore.js";

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

function CreateStorage(): Storage
{
	const records = new Map<string, string>();
	return {
		get length(): number { return records.size; },
		clear(): void { records.clear(); },
		getItem: (key) => records.get(key) ?? null,
		key: (index) => [...records.keys()][index] ?? null,
		removeItem: (key) => records.delete(key),
		setItem: (key, value) => records.set(key, value)
	};
}

describe("DreamController", function DreamControllerTests()
{
	let controller: DreamController;
	let store: DreamStore;
	let events: ChoraEventBus<ChoraEvents>;
	let storage: Storage;
	let saved: DreamView[];
	let signalStore: SignalStore;

	beforeEach(() =>
	{
		vi.useFakeTimers();
		storage = CreateStorage();
		saved = [];
		let nextId = 0;
		vi.stubGlobal("window", {
			sessionStorage: storage,
			chora: {
				ShowDreamSourceContextMenu: vi.fn().mockResolvedValue("lookup"),
				LookUpWord: vi.fn().mockResolvedValue(undefined),
				ListDreams: vi.fn(async () => saved),
				DeleteDream: vi.fn(async (dreamId: string) =>
				{
					saved = saved.filter((dream) => dream.id !== dreamId);
				}),
				SaveDream: vi.fn(async (dream: DreamView) =>
				{
					saved = [structuredClone(dream)];
					return structuredClone(dream);
				}),
				AllocateDreamId: vi.fn(async () =>
				{
					nextId += 1;
					return `id-${nextId}`;
				}),
				SaveSignal: vi.fn(async (command) =>
				{
					nextId += 1;
					const selection = command.selections[0];
					return {
						id: command.signalId ?? `id-${nextId}`,
						workId: command.workId,
						sourceRef: selection.start.segmentKey,
						selections: command.selections,
						text: command.selections.map((item) => document.ReconstructText(item)).join(" … "),
						description: command.description,
						createdAt: "2026-01-01",
						updatedAt: "2026-01-01"
					};
				}),
				CopySelectedText: vi.fn(async () => undefined),
				CreateDreamSynopticView: vi.fn(async () => "## New Clarity Check\n\nA relationship."),
				CancelDreamSynopticView: vi.fn(async () => undefined)
			}
		});
		events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.Open(document, null);
		store = new DreamStore(new SessionStore());
		signalStore = new SignalStore();
		controller = new DreamController(events, errors, library, store, new DreamGateway(), signalStore);
	});

	afterEach(() =>
	{
		store.Dispose();
		vi.useRealTimers();
	});

	it("looks up only the selected source-passage text", async function LooksUpTextSelectionAsync()
	{
		await controller.HandleTextSelectionAsync({ documentId: "republic", start: { segmentKey: "s1", offset: 2 }, end: { segmentKey: "s1", offset: 4 }, selectedText: "cd", locatorStart: null, locatorEnd: null });
		expect(window.chora.ShowDreamSourceContextMenu).toHaveBeenCalledExactlyOnceWith(false);
		expect(window.chora.LookUpWord).toHaveBeenCalledExactlyOnceWith("cd");
	});

	it("adds different Dream source text to the selected Signal", async function AddsSourceToSelectedSignalAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 } });
		const existing = { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 2 } };
		await controller.AddSignal(existing);
		const signal = store.GetActiveDream()?.signals[0];
		const added = { documentId: "republic", start: { segmentKey: "s1", offset: 3 }, end: { segmentKey: "s1", offset: 5 } };
		vi.mocked(window.chora.ShowDreamSourceContextMenu).mockResolvedValueOnce("add-to-selected-signal");
		let request: ChoraEvents["signal.selection-add-requested"] | null = null;
		events.Subscribe("signal.selection-add-requested", function CaptureRequest(event): void
		{
			request = event;
		});

		await controller.HandleTextSelectionAsync(added);

		expect(window.chora.ShowDreamSourceContextMenu).toHaveBeenLastCalledWith(true);
		expect(request).toEqual({ signalId: signal?.id, selection: added });
	});

	it("disables adding the selected Signal text to itself from the Dream source", async function RejectsDuplicateSourceComponentAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 } });
		const existing = { documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 3 } };
		await controller.AddSignal(existing);
		const contained = { documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 2 } };

		await controller.HandleTextSelectionAsync(contained);

		expect(window.chora.ShowDreamSourceContextMenu).toHaveBeenLastCalledWith(false);
	});

	it("creates an empty Dream and orders manually-added signals by source", async function CreatesAndOrdersSignals()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s2", offset: 4 }, selectedText: "bcdef\nghij", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s2", offset: 1 }, end: { segmentKey: "s2", offset: 3 }, selectedText: "hi", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 2 }, end: { segmentKey: "s1", offset: 4 }, selectedText: "cd", locatorStart: null, locatorEnd: null });

		const dream = store.GetActiveDream();
		expect(dream?.title).toBe("");
		expect(dream?.reflection).toBe("");
		expect(dream?.synopticView).toBe("");
		expect(dream?.signals.map((signal) => signal.text)).toEqual(["cd", "hi"]);
	});

	it("reveals a canonical Signal after associating it with the active Dream", async function AssociatesCanonicalSignalAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s2", offset: 4 }, selectedText: "bcdef\nghij", locatorStart: null, locatorEnd: null });
		const signal: SignalRecord = {
			id: "signal-1",
			workId: "republic",
			sourceRef: "s1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 2 },
				end: { segmentKey: "s1", offset: 4 },
				selectedText: "cd",
				locatorStart: null,
				locatorEnd: null
			}],
			text: "cd",
			description: "",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};
		let addedSignalId: string | null = null;

		// Captures the reveal event used by the active DreamView panel.
		async function CaptureAddedSignal(event: ChoraEvents["dream.signal-added"]): Promise<void>
		{
			addedSignalId = event.signalId;
			await Promise.resolve();
		}

		const unsubscribe = events.Subscribe("dream.signal-added", CaptureAddedSignal);

		await controller.AssociateSignalAsync(signal);

		expect(store.GetActiveDream()?.signals.map((candidate) => candidate.id)).toContain(signal.id);
		expect(controller.GetSelectedSignal("id-1")).toBe(signal.id);
		expect(addedSignalId).toBe(signal.id);
		unsubscribe();
	});

	it("refreshes a Dream when its canonical Signal is edited elsewhere", async function RefreshesCanonicalSignalAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s2", offset: 4 }, selectedText: "bcdef\nghij", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 2 }, end: { segmentKey: "s1", offset: 4 }, selectedText: "cd", locatorStart: null, locatorEnd: null });
		const signal = store.GetActiveDream()?.signals[0];

		if (signal !== undefined)
		{
			await events.PublishAsync("signal.changed", {
				signal: {
					...signal,
					workId: "republic",
					description: "Updated from the Idea",
					createdAt: "2026-01-01",
					updatedAt: "2026-01-02"
				}
			});

		}

		expect(store.GetActiveDream()?.signals[0]?.description).toBe("Updated from the Idea");
	});

	it("resolves canonical Signals after the Signal store finishes loading", async function ResolvesSignalsAfterLoadingAsync()
	{
		const signal: SignalRecord = {
			id: "signal-1",
			workId: "republic",
			sourceRef: "s1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 3 },
				selectedText: "abc",
				locatorStart: null,
				locatorEnd: null
			}],
			text: "abc",
			description: "A canonical Signal",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};
		saved = [{
			id: "dream-1",
			workId: "republic",
			dialogue: "Republic",
			title: "A Dream",
			source: {
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 6 },
				selectedText: "abcdef",
				locatorStart: null,
				locatorEnd: null,
				sourceRefs: ["s1"],
				startSourceRef: "s1",
				endSourceRef: "s1"
			},
			signalIds: [signal.id],
			signals: [],
			reflection: "",
			synopticView: "",
			linkedDreamIds: [],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		}];

		await controller.RefreshAsync();
		expect(store.GetCatalogue()[0]?.signals).toHaveLength(0);

		signalStore.SetWork("republic", [signal]);
		await controller.RefreshAsync();

		expect(store.GetCatalogue()[0]?.signals.map(function GetSignalId(candidate): string
		{
			return candidate.id;
		})).toEqual(["signal-1"]);
	});

	it("updates only affected Dream structures when a Signal is deleted", async function DeletesSignalWithoutRefreshingCatalogueAsync()
	{
		const signal: SignalRecord = {
			id: "signal-1",
			workId: "republic",
			sourceRef: "s1",
			selections: [{
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 3 }
			}],
			text: "abc",
			description: "",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};
		const associated: DreamView = {
			id: "associated",
			workId: "republic",
			dialogue: "Republic",
			title: "Associated",
			source: {
				documentId: "republic",
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 6 }
			},
			signalIds: [signal.id],
			signals: [signal],
			reflection: "",
			synopticView: "",
			linkedDreamIds: [],
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};
		const unrelated: DreamView = {
			...structuredClone(associated),
			id: "unrelated",
			title: "Unrelated",
			signalIds: [],
			signals: []
		};
		store.SetCatalogue([associated, unrelated]);
		store.Open(associated, false);
		const changedDreamIds: string[] = [];
		let catalogueChanges = 0;
		events.Subscribe("dream.structure-changed", function CaptureStructureChange(event): void
		{
			changedDreamIds.push(event.dreamId);
		});
		events.Subscribe("dream.catalogue-changed", function CountCatalogueChange(): void
		{
			catalogueChanges += 1;
		});

		await events.PublishAsync("signal.deleted", { signalId: signal.id, workId: signal.workId });

		expect(changedDreamIds).toEqual(["associated"]);
		expect(catalogueChanges).toBe(0);
		expect(store.GetCatalogue().map(function SelectDream(dream): Pick<DreamView, "id" | "signalIds">
		{
			return { id: dream.id, signalIds: dream.signalIds };
		})).toEqual([
			{ id: "associated", signalIds: [] },
			{ id: "unrelated", signalIds: [] }
		]);
	});

	it("jumps the reader to a selected Signal", async function ViewsSignalAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 }, selectedText: "abcdef", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 2 }, end: { segmentKey: "s1", offset: 4 }, selectedText: "cd", locatorStart: null, locatorEnd: null });
		const signal = store.GetActiveDream()?.signals[0];
		let selectedText = "";
		events.Subscribe("library.jump-requested", function CaptureJump(event): void
		{
			selectedText = (event.selections ?? []).map((selection) => document.ReconstructText(selection)).join(" … ");
		});

		if (signal !== undefined) await controller.ViewSignalAsync(signal.id);

		expect(selectedText).toBe("cd");
	});

	it("checks clarity from current reader-authored work without feeding back the prior result", async function CreatesFreshSynopticViewAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 }, selectedText: "abcdef", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 2 }, selectedText: "ab", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 3 }, end: { segmentKey: "s1", offset: 6 }, selectedText: "def", locatorStart: null, locatorEnd: null });
		const signals = store.GetActiveDream()?.signals ?? [];
		if (signals[0] !== undefined) controller.UpdateSignal(signals[0].id, "The first movement.");
		if (signals[1] !== undefined) controller.UpdateSignal(signals[1].id, "The second movement.");
		controller.UpdateReflection("Descent and return.");
		controller.UpdateSynopticView("An earlier generated interpretation.");

		await controller.CreateSynopticViewAsync();

		const request = vi.mocked(window.chora.CreateDreamSynopticView).mock.calls[0]?.[0];
		expect(request?.readingDocument).toContain("## Reflections");
		expect(request?.readingDocument).toContain("Descent and return.");
		expect(request?.readingDocument).toContain("> ab");
		expect(request?.readingDocument).toContain("The first movement.");
		expect(request?.readingDocument).toContain("> def");
		expect(request?.readingDocument).toContain("The second movement.");
		expect(request?.readingDocument).not.toContain("An earlier generated interpretation.");
		expect(store.GetActiveDream()?.synopticView).toContain("New Clarity Check");
	});

	it("does not apply a response after the Dream input changes", async function RejectsStaleSynopticViewAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 }, selectedText: "abcdef", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("Initial reflection.");
		let resolve: ((value: string) => void) | null = null;
		vi.mocked(window.chora.CreateDreamSynopticView).mockImplementationOnce(() => new Promise<string>((complete) => { resolve = complete; }));
		const request = controller.CreateSynopticViewAsync();
		await Promise.resolve();
		controller.UpdateReflection("Changed while generating.");
		if (resolve === null) throw new Error("Clarity Check request did not start.");
		resolve("Stale Clarity Check");
		await request;

		expect(store.GetActiveDream()?.synopticView).toBe("");
	});

	it("copies a Clarity Check without changing the reader's Reflections", async function CopiesSynopticViewAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 }, selectedText: "abcdef", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("Reader reflection.");
		controller.UpdateSynopticView("Generated view.");

		await controller.CopySynopticViewAsync();
		expect(window.chora.CopySelectedText).toHaveBeenCalledWith("Generated view.");
		expect(store.GetActiveDream()?.reflection).toBe("Reader reflection.");
		expect(store.GetActiveDream()?.synopticView).toBe("Generated view.");
	});

	it("does not complete Signal creation before the reveal workflow finishes", async function AwaitsSignalRevealAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s2", offset: 4 }, selectedText: "bcdef\nghij", locatorStart: null, locatorEnd: null });
		let releaseReveal: (() => void) | null = null;
		let markStarted: (() => void) | null = null;
		const revealReleased = new Promise<void>(function CaptureRelease(resolve): void
		{
			releaseReveal = resolve;
		});
		const revealStarted = new Promise<void>(function CaptureStart(resolve): void
		{
			markStarted = resolve;
		});

		// Blocks the panel-side reveal until the test explicitly releases it.
		async function HandleSignalAddedAsync(): Promise<void>
		{
			if (markStarted !== null)
			{
				markStarted();
			}

			await revealReleased;
		}

		const unsubscribe = events.Subscribe("dream.signal-added", HandleSignalAddedAsync);
		const addition = controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 2 }, end: { segmentKey: "s1", offset: 4 }, selectedText: "cd", locatorStart: null, locatorEnd: null });
		await revealStarted;
		let additionFinished = false;

		// Observes completion without releasing the blocked reveal.
		function MarkAdditionFinished(): void
		{
			additionFinished = true;
		}

		const completion = addition.then(MarkAdditionFinished);
		await Promise.resolve();
		expect(additionFinished).toBe(false);

		if (releaseReveal === null)
		{
			throw new Error("Signal reveal did not start");
		}

		releaseReveal();
		await completion;
		expect(additionFinished).toBe(true);
		unsubscribe();
	});

	it("opens Add to Idea directly for one canonical Signal", async function OpensIdeaActions()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s2", offset: 4 }, selectedText: "bcdef\nghij", locatorStart: null, locatorEnd: null });
		await controller.AddSignal({ documentId: "republic", start: { segmentKey: "s1", offset: 2 }, end: { segmentKey: "s1", offset: 4 }, selectedText: "cd", locatorStart: null, locatorEnd: null });
		const signalId = store.GetActiveDream()?.signals[0]?.id;

		if (signalId === undefined)
		{
			throw new Error("Missing Signal");
		}

		const add = vi.fn();
		const unsubscribeAddition = events.Subscribe("idea.add-signal-requested", add);

		await controller.AddSignalToIdeaAsync(signalId);

		const dreamId = store.GetActiveDream()?.id;
		expect(add).toHaveBeenCalledWith({ dreamId, signalId });
		unsubscribeAddition();
	});

	it("does not expose mutable active Dream state", async function ProtectsActiveDreamState()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "bc", locatorStart: null, locatorEnd: null });
		const snapshot = store.GetActiveDream();
		const revision = store.GetRevision();

		if (snapshot !== null)
		{
			snapshot.title = "Untracked mutation";
		}

		expect(store.GetActiveDream()?.title).toBe("");
		expect(store.GetRevision()).toBe(revision);
	});

	it("extends a Dream source passage in canonical source order", async function ExtendsSource()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "bc", locatorStart: null, locatorEnd: null });
		let highlightedSource = "";
		events.Subscribe("library.jump-requested", function CaptureSourceRefresh(event): void
		{
			if (event.target === "source") highlightedSource = document.ReconstructText(event.selection);
		});

		await controller.ExtendSourceAsync({ documentId: "republic", start: { segmentKey: "s1", offset: 3 }, end: { segmentKey: "s1", offset: 6 }, selectedText: "def", locatorStart: null, locatorEnd: null });

		const source = store.GetActiveDream()?.source;
		expect(source?.start).toEqual({ segmentKey: "s1", offset: 1 });
		expect(source?.end).toEqual({ segmentKey: "s1", offset: 6 });
		expect(source === undefined ? "" : document.ReconstructText(source)).toBe("bcdef");
		expect(source?.start.segmentKey).toBe("s1");
		expect(source?.end.segmentKey).toBe("s1");
		expect(highlightedSource).toBe("bcdef");
	});

	it("rejects a non-adjacent Dream source extension", async function RejectsSeparatedSourceAsync()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "bc", locatorStart: null, locatorEnd: null });

		await controller.ExtendSourceAsync({ documentId: "republic", start: { segmentKey: "s2", offset: 1 }, end: { segmentKey: "s2", offset: 4 }, selectedText: "hij", locatorStart: null, locatorEnd: null });

		expect(store.GetActiveDream()?.source).toEqual(expect.objectContaining({
			start: { segmentKey: "s1", offset: 1 },
			end: { segmentKey: "s1", offset: 3 }
		}));
	});

	it("debounces Dream draft persistence while preserving recovery", async function RestoresDraft()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		const setItem = vi.spyOn(storage, "setItem");
		controller.UpdateReflection("A remembered perception.");
		controller.UpdateReflection("A remembered perception growing.");

		expect(setItem).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(399);
		expect(setItem).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(setItem).toHaveBeenCalledOnce();
		const restored = new DreamStore(new SessionStore());

		expect(restored.GetActiveDream()?.reflection).toBe("A remembered perception growing.");
		expect(restored.GetIsDirty()).toBe(true);
	});

	it("saves the complete Dream and reports a saved state", async function SavesDream()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("A perception.");

		await controller.SaveAsync();

		expect(saved[0]?.reflection).toBe("A perception.");
		expect(store.GetIsDirty()).toBe(false);
		expect(store.GetSaveState()).toBe("idle");
	});

	it("autosaves a changed Dream after the editing pause", async function AutosavesDream()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("A perception preserved automatically.");

		await vi.advanceTimersByTimeAsync(749);
		expect(saved).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);

		expect(saved[0]?.reflection).toBe("A perception preserved automatically.");
		expect(store.GetIsDirty()).toBe(false);
	});

	it("saves a dirty Dream before the editor closes", async function SavesOnClose()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("Saved while closing.");

		await controller.CloseAsync();

		expect(saved[0]?.reflection).toBe("Saved while closing.");
		expect(store.GetActiveDream()).toBeNull();
		expect(store.GetCatalogue()).toHaveLength(1);
	});

	it("keeps a dirty Dream open when the close save fails", async function PreservesFailedClose()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("This must not be discarded.");
		vi.mocked(window.chora.SaveDream).mockRejectedValueOnce(new Error("Disk unavailable"));

		await controller.CloseAsync();

		expect(store.GetActiveDream()?.reflection).toBe("This must not be discarded.");
		expect(store.GetIsDirty()).toBe(true);
		expect(store.GetSaveState()).toBe("error");
	});

	it("uses Dream state as the only user-facing save result and recovers on retry", async function RecoversFailedSave()
	{
		const reported = vi.fn();
		events.Subscribe("error.reported", reported);
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		controller.UpdateReflection("Retain this draft.");
		vi.mocked(window.chora.SaveDream).mockRejectedValueOnce(new Error("Disk unavailable"));

		await controller.SaveAsync();

		expect(store.GetIsDirty()).toBe(true);
		expect(store.GetSaveState()).toBe("error");
		expect(reported).not.toHaveBeenCalled();

		await controller.SaveAsync();

		expect(store.GetIsDirty()).toBe(false);
		expect(store.GetSaveState()).toBe("idle");
		expect(saved[0]?.reflection).toBe("Retain this draft.");
	});

	it("deletes the active Dream and refreshes the catalogue", async function DeletesDream()
	{
		await controller.Create({ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 }, selectedText: "abc", locatorStart: null, locatorEnd: null });
		await controller.SaveAsync();

		await controller.DeleteAsync();

		expect(window.chora.DeleteDream).toHaveBeenCalledOnce();
		expect(store.GetActiveDream()).toBeNull();
		expect(store.GetCatalogue()).toEqual([]);
	});
});
