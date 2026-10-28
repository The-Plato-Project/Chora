import { DreamSaveCoordinator } from "../../src/renderer/dreams/DreamSaveCoordinator.js";
import { DreamCatalogueController } from "../../src/renderer/dreams/DreamCatalogueController.js";
import { DreamClarityCheckController } from "../../src/renderer/dreams/DreamClarityCheckController.js";
import { DreamExportController } from "../../src/renderer/dreams/DreamExportController.js";
import { DreamExplorerController } from "../../src/renderer/workspace/DreamExplorerController.js";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ReadingSettingsStore } from "../../src/renderer/core/settings/ReadingSettingsStore.js";
import { DreamPanel } from "../../src/renderer/dreams/DreamPanel.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { UpdateDreamCommand } from "../../src/shared/dreams/DreamTypes.js";
import { OpenIcon, TextQuoteIcon } from "../../src/renderer/ui/Icons.js";

// Creates a small persisted DreamView with two independently editable signals.
function CreateDream(): DreamView
{
	const selection = {
		documentId: "republic", start: { segmentKey: "s1", offset: 0 },
		end: { segmentKey: "s1", offset: 6 }
	};
	const dream: DreamView = {
		id: "dream-1", workId: "republic", dialogue: "Republic", title: "A long Dream title",
		source: selection,
		signals: [
			{ id: "signal-1", dreamId: "dream-1", workId: "republic", text: "abc", description: "First description", sourceRef: "s1", selections: [selection], createdAt: "2026-09-06", updatedAt: "2026-09-06" },
			{ id: "signal-2", dreamId: "dream-1", workId: "republic", text: "def", description: "Second description", sourceRef: "s1", selections: [selection], createdAt: "2026-09-06", updatedAt: "2026-09-06" }
		],
		reflection: "Initial Reflections", synopticView: "", linkedDreamIds: [], createdAt: "2026-09-06", updatedAt: "2026-09-06"
	};
	return dream;
}

// Selects editor content and activates its bold toolbar action.
function FormatBold(root: HTMLElement): void
{
	const content = root.querySelector<HTMLElement>("[contenteditable=true]")!;
	content.focus();
	const range = document.createRange();
	range.selectNodeContents(content);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
	root.querySelector<HTMLButtonElement>('[data-markdown-command="bold"]')!.click();
}

// Requires one document element for rename workflow assertions.
function RequireDocumentElement<T extends Element>(selector: string): T
{
	const element = document.querySelector<T>(selector);

	if (element === null)
	{
		throw new Error(`Missing test element: ${selector}`);
	}

	return element;
}

// Requires one ancestor element for rename workflow assertions.
function RequireClosestElement<T extends Element>(element: Element, selector: string): T
{
	const closest = element.closest<T>(selector);

	if (closest === null)
	{
		throw new Error(`Missing test ancestor: ${selector}`);
	}

	return closest;
}

describe("DreamPanel", function DreamPanelTests()
{
	let panel: DreamPanel;
	let root: HTMLElement;
	let store: DreamStore;
	let events: ChoraEventBus<ChoraEvents>;
	let gateway: DreamGateway;
	let reader: LibraryGateway;
	let controller: DreamController;
	let saves: DreamSaveCoordinator;
	let clarity: DreamClarityCheckController;
	let catalogueController: DreamCatalogueController;
	let explorer: DreamExplorerController;
	let exporter: DreamExportController;
	let library: LibraryStore;
	let auxiliaryPanels: DreamPanel[];

	beforeEach(async function SetupAsync()
	{
		window.sessionStorage.clear();
		root = document.createElement("div");
		document.body.append(root);
		events = new ChoraEventBus<ChoraEvents>();
		store = new DreamStore(new SessionStore());
		const dream = CreateDream();
		store.Open(dream, false);
		gateway = new DreamGateway();
		reader = new LibraryGateway();
		vi.spyOn(gateway, "ListAsync").mockResolvedValue([dream]);
		vi.spyOn(gateway, "UpdateAsync").mockImplementation(async function UpdateAsync(command: UpdateDreamCommand): Promise<Dream>
		{
			const current = store.GetActiveDream() ?? dream;
			const saved: Dream = {
				...current,
				title: command.title,
				source: structuredClone(command.source),
				reflection: command.reflection,
				synopticView: command.synopticView,
				linkedDreamIds: [...command.linkedDreamIds]
			};
			return saved;
		});
		library = new LibraryStore();
		library.Open({
			id: "republic",
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
			segments: [
				{
					key: "s1",
					citation: { system: "stephanus", value: "327a" },
					text: "abcdef",
					annotations: [
						{ kind: "quotation", start: 1, end: 3 },
						{ kind: "citation", start: 3, end: 5 }
					]
				},
				{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: "ghijkl" }
			]
		} as never, null);
		auxiliaryPanels = [];
		const errors = new ErrorManager(events);
		saves = new DreamSaveCoordinator(events, errors, store, gateway);
		clarity = new DreamClarityCheckController(events, errors, library, store, gateway, saves);
		catalogueController = new DreamCatalogueController(events, errors, library, store, gateway, saves, clarity);
		explorer = new DreamExplorerController(store, library, gateway, events, errors, catalogueController, { HasUncommittedChanges: function HasUncommittedChanges(): boolean { return false; } });
		exporter = new DreamExportController(store, library, reader);
		controller = new DreamController(events, errors, library, store, gateway, reader, saves);
		panel = new DreamPanel(root, events, store, controller, library, "editor", catalogueController, saves, clarity, exporter, explorer);
		await vi.waitFor(function EditorsReady(): void
		{
			expect(root.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
		});
		vi.useFakeTimers();
	});

	afterEach(function Cleanup()
	{
		panel.Dispose();
		for (const auxiliaryPanel of auxiliaryPanels) auxiliaryPanel.Dispose();
		explorer.Dispose();
		catalogueController.Dispose();
		clarity.Dispose();
		controller.Dispose();
		saves.Dispose();
		store.Dispose();
		document.body.replaceChildren();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("keeps Dream deletion out of the editor surface", function HidesDeleteFromEditor(): void
	{
		const deleteDream = vi.spyOn(gateway, "DeleteAsync").mockResolvedValue();
		expect(root.querySelector("[data-delete-dream]")).toBeNull();
		expect(deleteDream).not.toHaveBeenCalled();
	});

	// Opens the rename workflow from the DreamView Explorer, where title editing is exposed.
	function OpenRenameFromCatalogue(): void
	{
		const activeDream = store.GetActiveDream();
		if (activeDream !== null) store.SetCatalogue([activeDream], [], [{ dreamId: activeDream.id, workId: activeDream.workId, folderPath: "" }]);
		const catalogueRoot = document.createElement("div");
		document.body.append(catalogueRoot);
		const cataloguePanel = new DreamPanel(catalogueRoot, events, store, controller, library, "catalogue", catalogueController, saves, clarity, exporter, explorer);
		auxiliaryPanels.push(cataloguePanel);
		catalogueRoot.querySelector<HTMLButtonElement>("[data-rename-dream]")!.click();
	}

	it("opens, switches, and closes persistent Dream tabs without losing inner navigation", async function ManagesDreamTabsAsync()
	{
		const first = store.GetActiveDream()!;
		const second = structuredClone(first);
		second.id = "dream-2";
		second.title = "Second Dream";
		store.SetCatalogue([first, second], [], [
			{ dreamId: first.id, workId: first.workId, folderPath: "" },
			{ dreamId: second.id, workId: second.workId, folderPath: "" }
		]);
		const innerTabs = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		innerTabs[1]?.click();

		controller.Open(second.id);
		expect(store.GetOpenTabs()).toHaveLength(2);
		expect(store.GetActiveDream()?.id).toBe("dream-2");
		controller.ActivateTab("dream-1");

		expect(store.GetActiveDream()?.id).toBe("dream-1");
		expect(root.querySelector<HTMLButtonElement>('.dream-tabs-host [role=tab][aria-selected="true"]')?.textContent).toBe("Reflections");
		const restoredStore = new DreamStore(new SessionStore());
		expect(restoredStore.GetOpenTabs()).toHaveLength(2);
		expect(restoredStore.GetActiveDream()?.id).toBe("dream-1");
		expect(restoredStore.GetEditorTab("dream-1")).toBe("reflections");
		restoredStore.Dispose();

		await controller.CloseTabAsync("dream-1");
		expect(store.GetOpenTabs()).toHaveLength(1);
		expect(store.GetActiveDream()?.id).toBe("dream-2");
	});

	it("copies the complete Dream as Markdown from the outer document menu", async function CopiesDreamMarkdownAsync()
	{
		controller.UpdateSynopticView("The reader's developing account is visible.");
		const copy = vi.spyOn(reader, "CopyAsync").mockResolvedValue(undefined);
		const tabs = root.querySelectorAll<HTMLButtonElement>('.dream-tabs-host [role="tab"]');
		expect(Array.from(tabs, function Label(tab): string | null { return tab.textContent; })).toEqual(["Signals", "Reflections", "Clarity Check"]);
		tabs[2]?.click();
		const checkButton = root.querySelector<HTMLButtonElement>("[data-create-synoptic-view]");
		expect(checkButton?.title).toBe("Check clarity");
		expect(root.querySelector("[data-dream-synoptic-view] .markdown-toolbar")?.getAttribute("aria-label")).toBe("Clarity Check formatting");
		void exporter.CopyDreamAsMarkdownAsync();
		await vi.waitFor(function DreamCopied(): void { expect(copy).toHaveBeenCalledOnce(); });
		const markdown = vi.mocked(copy).mock.calls[0]?.[0] ?? "";
		expect(markdown).toContain("# A long Dream title");
		expect(markdown).toContain("## Source Passage");
		expect(markdown).toContain("### Signal");
		expect(markdown).toContain("> abc");
		expect(markdown).toContain("Source: Republic · s1");
		expect(markdown).toContain("#### Observation");
		expect(markdown).toContain("First description");
		expect(markdown).toContain("## Reflections");
		expect(markdown).toContain("Initial Reflections");
		expect(markdown).toContain("## Clarity Check");
		expect(markdown).not.toContain("## Synoptic View");
	});

	it("generates an editable Clarity Check and copies it to the clipboard", async function CreatesAndCopiesSynopticViewAsync()
	{
		let complete: ((value: string) => void) | null = null;
		vi.spyOn(gateway, "CreateSynopticViewAsync").mockImplementation(() => new Promise<string>((resolve) => { complete = resolve; }));
		const copy = vi.spyOn(reader, "CopyAsync").mockResolvedValue(undefined);
		const tabs = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		tabs[2]!.click();
		const create = root.querySelector<HTMLButtonElement>("[data-create-synoptic-view]")!;
		expect(create.title).toBe("Check clarity");
		expect(create.textContent).toBe("");
		create.click();
		await vi.waitFor(function GenerationShown(): void
		{
			expect(create.title).toBe("Cancel");
			expect(root.querySelector<HTMLElement>("[data-synoptic-view-progress]")?.hidden).toBe(false);
		});
		await Promise.resolve();
		if (complete === null) throw new Error("Clarity Check request did not start.");
		complete("## Shared movement\n\nA generated relationship.");
		await vi.waitFor(function SynopticViewApplied(): void
		{
			expect(store.GetActiveDream()?.synopticView).toContain("Shared movement");
			expect(root.querySelector<HTMLElement>("[data-synoptic-view-progress]")?.hidden).toBe(true);
			expect(create.title).toBe("Check clarity");
		});

		const copyButton = root.querySelector<HTMLButtonElement>("[data-copy-synoptic-view]")!;
		expect(copyButton.title).toBe("Copy");
		expect(copyButton.textContent).toBe("");
		copyButton.click();
		await vi.waitFor(function SynopticViewCopied(): void { expect(copy).toHaveBeenCalledWith("## Shared movement\n\nA generated relationship."); });

		expect(store.GetActiveDream()?.reflection).toBe("Initial Reflections");
		expect(store.GetActiveDream()?.synopticView).toContain("Shared movement");
		expect(root.querySelector<HTMLButtonElement>('.dream-tabs-host [role=tab][aria-selected="true"]')?.textContent).toBe("Clarity Check");
	});

	it("does not replace a populated Clarity Check without confirmation", async function ProtectsSynopticViewAsync()
	{
		controller.UpdateSynopticView("Existing Clarity Check");
		await events.PublishAsync("dream.synoptic-view-state-changed", { dreamId: "dream-1" });
		const create = vi.spyOn(gateway, "CreateSynopticViewAsync").mockResolvedValue("Replacement");
		vi.spyOn(window, "confirm").mockReturnValue(false);
		root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]")[2]!.click();

		root.querySelector<HTMLButtonElement>("[data-create-synoptic-view]")!.click();

		expect(create).not.toHaveBeenCalled();
		expect(store.GetActiveDream()?.synopticView).toBe("Existing Clarity Check");
	});

	it("uses the document tab as the title and retains source disclosure on structural updates", async function PreservesSource()
	{
		expect(root.querySelector("[data-dream-title]")).toBeNull();
		expect(root.querySelector("[data-dream-heading]")).toBeNull();
		expect(root.querySelector(".signal-observation-heading")).toBeNull();
		expect(document.querySelectorAll(".popup-overlay")).toHaveLength(0);
		const title = root.querySelector<HTMLInputElement>("[data-dream-editor-title]")!;
		expect(title.value).toBe("A long Dream title");
		expect(root.querySelector("[data-dream-reflections]")).not.toBeNull();
		title.value = "A titled Dream";
		title.dispatchEvent(new Event("input", { bubbles: true }));
		expect(store.GetActiveDream()?.title).toBe("A titled Dream");
		const details = root.querySelector<HTMLDetailsElement>(".dream-source-section")!;
		const source = root.querySelector("[data-dream-source]")!;
		const sourceJump = details.querySelector<HTMLButtonElement>(":scope > [data-jump-source]")!;
		const jumps: ChoraEvents["library.jump-requested"][] = [];
		events.Subscribe("library.jump-requested", function CaptureSourceJump(event): void
		{
			jumps.push(event);
		});
		expect(source.tagName).toBe("BLOCKQUOTE");
		expect(source.querySelector(".source-quotation-text")?.textContent).toBe("bc");
		expect(source.querySelector(".source-quotation-citation")?.textContent).toBe("de");
		expect(source.textContent).toBe("abcdef");
		expect(details.open).toBe(true);
		expect(details.style.height).not.toBe("");
		expect(sourceJump.getAttribute("aria-label")).toBe("Jump to source passage");
		sourceJump.click();
		await vi.waitFor(function SourceJumped(): void
		{
			expect(jumps).toHaveLength(1);
		});
		expect(jumps[0]?.selection).toEqual(store.GetActiveDream()?.source);
		expect(details.open).toBe(true);
		const divider = root.querySelector<HTMLElement>("[data-dream-source-divider]")!;
		const editor = root.querySelector<HTMLElement>(".dream-editor.document-editor")!;
		vi.spyOn(details, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 144));
		vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 700, 800));
		divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(details.style.height).toBe("168px");
		expect(window.localStorage.getItem("chora:layout-settings")).toContain('"dreamSourceHeight":168');
		await events.PublishAsync("dream.structure-changed", { dreamId: "dream-1" });
		expect(root.querySelector(".dream-source-section")).toBe(details);
		expect(details.open).toBe(true);
		expect(source.textContent).toBe("abcdef");
	});

	it("applies reading size to Dream content", async function ScalesDreamContentAsync()
	{
		const stylesheet = document.createElement("style");
		const styles = ["base", "workspace-theme", "left-tab-panels", "dark-theme", "tabs", "dream-editor", "markdown-editor", "responsive"];
		stylesheet.textContent = styles.map(function ReadStyle(name): string
		{
			const content = readFileSync(`src/renderer/styles/${name}.css`, "utf8");
			return content;
		}).join("\n");
		const previousStyle = document.documentElement.style.cssText;
		const previousTheme = document.documentElement.dataset.theme;
		const previousSettings = window.localStorage.getItem("chora:reading-settings");
		document.head.append(stylesheet);
		try
		{
			const settings = new ReadingSettingsStore();
			settings.Apply();
			const selectors = [".dream-source", ".signal-markdown-editor .ProseMirror p", ".dream-reflections-markdown .ProseMirror p"];
			const formattingToolbar = root.querySelector<HTMLElement>(".signal-markdown-editor .markdown-toolbar")!;
			expect(getComputedStyle(root.querySelector<HTMLElement>(".signal-heading")!).fontSize).toBe("12px");
			expect(getComputedStyle(formattingToolbar).display).toBe("none");
			for (const delta of [0, 2, -1])
			{
				settings.ChangeFontSize(delta);
				expect(document.documentElement.style.getPropertyValue("--reading-font-size")).toBe(`${settings.GetFontSize()}px`);
				stylesheet.remove();
				document.head.append(stylesheet);
				for (const selector of selectors)
				{
					const content = root.querySelector<HTMLElement>(selector)!;
					expect(content, selector).not.toBeNull();
					expect(getComputedStyle(content).fontSize, selector).toBe(`${settings.GetFontSize()}px`);
				}
			}
		}
		finally
		{
			stylesheet.remove();
			document.documentElement.style.cssText = previousStyle;
			if (previousTheme === undefined) delete document.documentElement.dataset.theme;
			else document.documentElement.dataset.theme = previousTheme;
			if (previousSettings === null) window.localStorage.removeItem("chora:reading-settings");
			else window.localStorage.setItem("chora:reading-settings", previousSettings);
		}
	});

	it("preserves editors and expansion when switching tabs and autosaves content", async function PreservesEditors()
	{
		const buttons = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		expect(buttons[1]?.textContent).toBe("Reflections");
		const toggle = root.querySelector<HTMLButtonElement>("[data-signal-toggle]")!;
		toggle.click();
		const description = root.querySelector<HTMLElement>("[data-signal-description]")!;
		FormatBold(description);
		buttons[1]!.click();
		const reflections = root.querySelector<HTMLElement>("[data-dream-reflections]")!;
		FormatBold(reflections);
		buttons[0]!.click();
		expect(root.querySelector("[data-signal-toggle]")).toBe(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(description.hidden).toBe(false);
		expect(description.querySelector("strong")?.textContent).toBe("First description");
		expect(root.querySelector("[data-dream-reflections]")).toBe(reflections);
		await vi.advanceTimersByTimeAsync(800);
		expect(gateway.UpdateAsync).toHaveBeenCalledWith(expect.objectContaining({ reflection: expect.stringContaining("**Initial Reflections**") }));
		expect(store.GetSaveState()).toBe("idle");
	});

	it("selects one Signal at a time without scrolling or moving focus", async function SelectsOneSignalAsync()
	{
		const jumps: ChoraEvents["library.jump-requested"][] = [];
		events.Subscribe("library.jump-requested", function CaptureSignalJump(event): void
		{
			jumps.push(event);
		});
		const first = root.querySelector<HTMLElement>('[data-signal-id="signal-1"]')!;
		const second = root.querySelector<HTMLElement>('[data-signal-id="signal-2"]')!;
		const editor = first.querySelector("[contenteditable=true]");
		expect(first.hidden).toBe(false);
		expect(second.hidden).toBe(true);
		expect(second.querySelector("[contenteditable=true]")).toBeNull();
		expect(first.querySelector(".signal-detail-heading")).toBeNull();
		expect(first.querySelector("[data-signal-edit]")).toBeNull();
		expect(first.querySelector(".signal-detail-title [data-signal-chat]")).toBeNull();
		expect(root.querySelector('[data-signal-toggle="signal-1"]')?.textContent).toBe("abc");
		root.querySelector<HTMLButtonElement>('[data-signal-toggle="signal-2"]')!.click();
		expect(first.hidden).toBe(true);
		expect(second.hidden).toBe(false);
		await vi.waitFor(function SelectedDescriptionLoaded(): void
		{
			expect(second.querySelector("[contenteditable=true]")?.textContent).toBe("Second description");
		});
		expect(jumps).toHaveLength(0);
		const actions = second.querySelector<HTMLElement>(".signal-editor-actions")!;
		const jumpButton = actions.querySelector<HTMLButtonElement>("[data-jump-signal]")!;
		const removeButton = actions.querySelector<HTMLButtonElement>("[data-delete-signal]")!;
		expect(jumpButton.nextElementSibling).toBe(removeButton);
		jumpButton.click();
		await vi.waitFor(function SignalJumped(): void
		{
			expect(jumps).toHaveLength(1);
		});
		const secondEditor = second.querySelector("[contenteditable=true]");
		expect(document.activeElement).not.toBe(secondEditor);
		root.querySelector<HTMLButtonElement>('[data-signal-toggle="signal-1"]')!.click();
		await Promise.resolve();
		expect(first.hidden).toBe(false);
		expect(first.querySelector("[contenteditable=true]")).toBe(editor);
		expect(document.activeElement).not.toBe(editor);
		expect(jumps).toHaveLength(1);
	});

	it("resizes the Signal list with its divider and shows complete Signal tooltips", function ResizesSignalList(): void
	{
		const body = root.querySelector<HTMLElement>(".signal-view-body")!;
		const list = root.querySelector<HTMLElement>(".signal-view-body > .signal-list")!;
		const divider = root.querySelector<HTMLElement>(".signal-view-divider")!;
		const first = root.querySelector<HTMLButtonElement>('[data-signal-toggle="signal-1"]')!;
		vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 500));
		vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 232, 500));
		vi.spyOn(divider, "getBoundingClientRect").mockReturnValue(new DOMRect(232, 0, 5, 500));

		divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

		expect(first.title).toBe("abc");
		expect(divider.getAttribute("role")).toBe("separator");
		expect(divider.getAttribute("aria-orientation")).toBe("vertical");
		expect(divider.getAttribute("aria-valuenow")).toBe("256");
		expect(body.style.getPropertyValue("--signal-navigation-width")).toBe("256px");
		expect(window.localStorage.getItem("chora:layout-settings")).toContain('"signalNavigationWidth":256');
	});

	it("creates a Signal only through selected Dream source text", async function CreatesSignalFromSourceSelectionAsync()
	{
		const signalButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".dream-signals-panel button"));
		expect(signalButtons.some((button) => button.textContent?.includes("Add new") === true)).toBe(false);
		const source = root.querySelector<HTMLElement>("[data-dream-source]")!;
		const textNode = source.querySelector(".source-quotation-text")?.firstChild ?? null;
		if (textNode === null)
		{
			throw new Error("Dream source text was not rendered.");
		}
		const range = document.createRange();
		range.setStart(textNode, 0);
		range.setEnd(textNode, 2);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		const sourceMenu = vi.spyOn(gateway, "ShowSourceContextMenuAsync").mockResolvedValue("add-dream-source-signal");
		let requested: ChoraEvents["dream.signal-add-requested"] | null = null;
		events.Subscribe("dream.signal-add-requested", function CaptureRequest(event): void
		{
			requested = event;
		});

		source.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

		await vi.waitFor(function SignalCreated(): void
		{
			expect(sourceMenu).toHaveBeenCalledWith(false);
			expect(requested).toEqual({
				selection: expect.objectContaining({
				documentId: "republic",
				start: { segmentKey: "s1", offset: 1 },
				end: { segmentKey: "s1", offset: 3 }
				})
			});
		});
	});

	it("offers one unambiguous Signal deletion confirmation", function ConfirmsSignalDeletion()
	{
		const remove = root.querySelector<HTMLButtonElement>("[data-delete-signal]")!;
		expect(remove.textContent).toBe("");
		expect(remove.title).toBe("Delete Signal");
		expect(root.querySelector('[data-signal-id="signal-1"][data-remove-signal-passage]')).toBeNull();

		remove.click();
		const prompt = document.querySelector<HTMLElement>("[data-signal-delete-confirm]")?.closest<HTMLElement>(".popup-overlay");
		const cancel = prompt?.querySelector<HTMLButtonElement>("[data-signal-delete-cancel]");
		expect(prompt?.hidden).toBe(false);
		expect(prompt?.textContent).toContain("abc");
		expect(prompt?.textContent).not.toContain("Remove from this Dream");
		expect(prompt?.textContent).not.toContain("Everywhere");
		expect(document.activeElement).toBe(cancel);
		cancel?.click();
		expect(store.GetActiveDream()?.signals).toHaveLength(2);
	});

	it("renames Dreams without exposing deletion on Signal rows", async function EditsSettings()
	{
		expect(root.querySelector("[data-dream-heading]")).toBeNull();
		OpenRenameFromCatalogue();
		const input = RequireDocumentElement<HTMLInputElement>("[data-dream-title]");
		const overlay = RequireClosestElement<HTMLElement>(input, ".popup-overlay");
		const save = RequireDocumentElement<HTMLButtonElement>("[data-dream-rename-save]");
		expect(document.activeElement).toBe(input);
		expect(save.textContent).toBe("Save");
		input.value = "Renamed Dream";
		expect(store.GetActiveDream()?.title).toBe("A long Dream title");
		save.click();
		await vi.waitFor(function RenameSaved(): void
		{
			expect(overlay.hidden).toBe(true);
		});
		await vi.waitFor(function DreamRenamed(): void
		{
			expect(store.GetActiveDream()?.title).toBe("Renamed Dream");
		});
		const reflections = root.querySelector("[data-dream-reflections]");
		expect(document.querySelector("[data-settings-signals]")).toBeNull();
		const activeSignal = root.querySelector<HTMLElement>(".signal-item:not([hidden])")!;
		expect(activeSignal.querySelectorAll(".action-menu")).toHaveLength(0);
		expect(activeSignal.querySelector("[data-delete-signal]")).not.toBeNull();
		expect(root.querySelector("[data-delete-signal]")).not.toBeNull();
		expect(document.querySelector("[data-dream-title]")).toBe(input);
		expect(root.querySelector("[data-dream-reflections]")).toBe(reflections);
		expect(store.GetActiveDream()?.signals).toHaveLength(2);
		expect(root.querySelector('[data-signal-id="signal-1"]')).not.toBeNull();
		expect(gateway.UpdateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed Dream" }));
		expect(store.GetSaveState()).toBe("idle");
	});

	it("saves and closes the rename dialog when Enter is pressed", async function RenamesWithEnter()
	{
		OpenRenameFromCatalogue();
		const input = RequireDocumentElement<HTMLInputElement>("[data-dream-title]");
		const overlay = RequireClosestElement<HTMLElement>(input, ".popup-overlay");
		input.value = "Named with Enter";

		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		await vi.waitFor(function RenameSaved(): void
		{
			expect(overlay.hidden).toBe(true);
		});
		expect(store.GetActiveDream()?.title).toBe("Named with Enter");
		expect(gateway.UpdateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "Named with Enter" }));
	});

	it("keeps the rename dialog open when saving fails", async function RetainsFailedRename()
	{
		vi.mocked(gateway.UpdateAsync).mockRejectedValueOnce(new Error("Disk unavailable"));
		OpenRenameFromCatalogue();
		const input = RequireDocumentElement<HTMLInputElement>("[data-dream-title]");
		const overlay = RequireClosestElement<HTMLElement>(input, ".popup-overlay");
		const save = RequireDocumentElement<HTMLButtonElement>("[data-dream-rename-save]");
		const error = RequireDocumentElement<HTMLElement>("[data-dream-rename-error]");
		input.value = "Unsaved name";

		save.click();

		await vi.waitFor(function RenameFailed(): void
		{
			expect(error.hidden).toBe(false);
		});
		expect(overlay.hidden).toBe(false);
		expect(save.disabled).toBe(false);
		expect(store.GetSaveState()).toBe("error");
		expect(document.activeElement).toBe(input);
	});

	it("does not reveal or scroll to Signals when Dream structure changes", async function DoesNotAutoRevealSignals()
	{
		const reflectionsTab = root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1]!;
		reflectionsTab.click();
		reflectionsTab.focus();
		const active = store.GetActiveDream()!;
		const added = {
			...active.signals[0]!,
			id: "new-signal",
			title: "A named Signal",
			selections: [
				{ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } },
				{ documentId: "republic", start: { segmentKey: "s1", offset: 4 }, end: { segmentKey: "s1", offset: 6 } }
			],
			description: ""
		};
		store.SetOwnedSignals(active.id, [added, ...active.signals]);
		const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
		await events.PublishAsync("dream.structure-changed", { dreamId: active.id });

		expect(reflectionsTab.getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(reflectionsTab);
		expect(scroll).not.toHaveBeenCalled();
	});

	it("refreshes visible passages when an existing Signal changes", async function RefreshesSignalPassagesAsync()
	{
		const active = store.GetActiveDream()!;
		const signal = active.signals[0]!;
		const updated = {
			...signal,
			title: "Expanded Signal",
			selections: [
				signal.selections[0]!,
				{ documentId: "republic", start: { segmentKey: "s1", offset: 4 }, end: { segmentKey: "s1", offset: 6 } }
			],
			text: "abc … ef"
		};

		store.SetOwnedSignals(active.id, [updated, ...active.signals.slice(1)]);
		await events.PublishAsync("dream.structure-changed", { dreamId: active.id });

		const row = root.querySelector<HTMLElement>(`[data-signal-id="${signal.id}"]`)!;
		expect(row.querySelector<HTMLInputElement>("[data-signal-title]")?.value).toBe("Expanded Signal");
		expect(Array.from(row.querySelectorAll(".signal-passage-text"), function GetPassageText(item): string | null
		{
			return item.textContent;
		})).toEqual(["abcdef", "ef"]);
		expect(row.querySelectorAll("[data-remove-signal-passage]")).toHaveLength(2);
	});

	it("classifies, selects, navigates, and copies exact Signal passages", async function SelectsSignalPassagesAsync()
	{
		const signal = store.GetActiveDream()!.signals[0]!;
		const updated = {
			...signal,
			selections: [
				{ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } },
				{ documentId: "republic", start: { segmentKey: "s2", offset: 0 }, end: { segmentKey: "s2", offset: 3 } }
			]
		};
		const jumps: ChoraEvents["library.jump-requested"][] = [];
		events.Subscribe("library.jump-requested", function CaptureJump(event): void
		{
			jumps.push(event);
		});

		store.SetOwnedSignals("dream-1", [updated, ...store.GetActiveDream()!.signals.slice(1)]);
		await events.PublishAsync("dream.structure-changed", { dreamId: "dream-1" });

		const row = root.querySelector<HTMLElement>(`[data-signal-id="${signal.id}"]`)!;
		const sourcePassage = row.querySelector<HTMLElement>('[data-signal-passage-kind="source"]')!;
		const externalPassage = row.querySelector<HTMLElement>('[data-signal-passage-kind="external"]')!;
		expect(sourcePassage.querySelector(".signal-passage-navigation")?.innerHTML).toBe(TextQuoteIcon);
		expect(externalPassage.querySelector(".signal-passage-navigation")?.innerHTML).toBe(OpenIcon);

		externalPassage.querySelector<HTMLElement>(".signal-passage-text")?.click();
		expect(jumps).toHaveLength(0);
		expect(externalPassage.classList.contains("selected")).toBe(true);
		expect(externalPassage.getAttribute("aria-current")).toBe("true");
		expect(externalPassage.children[1]?.classList.contains("signal-passage-navigation")).toBe(true);

		const sourceText = sourcePassage.querySelector<HTMLElement>(".signal-passage-text")!;
		const range = document.createRange();
		range.selectNodeContents(sourceText);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		sourceText.click();
		expect(selection.toString()).toBe("abc");
		expect(jumps).toHaveLength(0);
		expect(externalPassage.classList.contains("selected")).toBe(true);

		selection.removeAllRanges();
		sourcePassage.querySelector<HTMLButtonElement>(".signal-passage-navigation")?.click();
		await vi.waitFor(function SourcePassageSelected(): void
		{
			expect(jumps).toHaveLength(1);
		});
		expect(sourcePassage.classList.contains("selected")).toBe(true);
		expect(externalPassage.classList.contains("selected")).toBe(false);
	});
});
