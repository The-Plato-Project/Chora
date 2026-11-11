import { ipcMain, type IpcMainInvokeEvent, type WebContents, type Event } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";
import type { StudyConversation, StudyScope, StudyUpdate } from "../../shared/study/StudyTypes.js";
import type { ChoraWindowManager } from "../bootstrap/WindowManager.js";
import { ResolveResourcePath } from "../bootstrap/ResourcePaths.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import type { LibraryModule } from "../library/LibraryModule.js";
import type { VisionModule } from "../visions/VisionModule.js";
import { StudyConversationRepository } from "./StudyConversationRepository.js";
import { StudyEvidence } from "./StudyEvidence.js";
import { StudySession } from "./StudySession.js";
import { GooseStudyBackend } from "./goose/GooseStudyBackend.js";

// Optional composition and trusted IPC boundary; removal leaves the reading features independent.
export class StudyModule
{
	// No runtime is constructed until an explicit Start command.
	private session: StudySession | null = null;
	// Prevents overlapping runtime launches.
	private starting = false;
	// Owns transcript persistence separately from Vision files.
	private readonly repository: StudyConversationRepository;
	// One renderer lifetime binding replaces accumulating session-specific listeners.
	private sender: WebContents | null = null;
	// Retains one removable callback for window loss.
	private readonly rendererClosed = this.RendererClosed.bind(this);
	// Retains one removable callback for main-frame replacement.
	private readonly rendererNavigated = this.RendererNavigated.bind(this);
	// Admitted turns are drained before replacing history or quitting Electron.
	private pending: Promise<StudyConversation> | null = null;
	// Invalidates work admitted before the latest Stop or replacement.
	private generation = 0;
	// Application-owned dependencies retain their existing persistence responsibilities.
	public constructor(private readonly windows: ChoraWindowManager, private readonly library: LibraryModule,
		private readonly visions: VisionModule, private readonly internalPath: string)
	{
		this.repository = new StudyConversationRepository(path.join(internalPath, "interlocutor"));
	}

	// Registers only narrow lifecycle commands, not an arbitrary tool or provider proxy.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.studyStart, this.StartAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.studySend, this.SendAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.studyStop, this.StopAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.studyHistory, this.LoadAsync.bind(this));
	}

	// Immediately revokes all execution capabilities on application shutdown.
	public Unregister(): void
	{
		this.generation += 1;
		this.BindSender(null);
		this.session?.Dispose();
		this.session = null;
		for (const channel of [IPC_CHANNELS.studyStart, IPC_CHANNELS.studySend, IPC_CHANNELS.studyStop, IPC_CHANNELS.studyHistory]) ipcMain.removeHandler(channel);
	}

	// Shutdown awaits the captured turn's final partial-history write.
	public async DrainAsync(): Promise<void>
	{
		this.generation += 1;
		const session = this.session;
		this.session = null;
		try
		{
			await session?.CancelAsync();
		}
		finally
		{
			try
			{
				await this.pending;
			}
			catch { /* The admitted IPC operation reports its own failure. */ }
		}
	}

	// Validates scope before launching a fixed, isolated local backend.
	private async StartAsync(event: IpcMainInvokeEvent, value: unknown): Promise<StudyConversation>
	{
		this.RequireSender(event);
		if (this.starting) throw ApplicationError.Expected("conflict", "STUDY_STARTING", "The interlocutor is already starting.");
		if (typeof value !== "object" || value === null || !("scope" in value) || !("model" in value)
			|| (value.model !== "qwen3.5:9b" && value.model !== "qwen3.5:4b")) throw new Error("Choose an available local model.");
		const input = value.scope;
		if (typeof input !== "object" || input === null || !("workId" in input) || typeof input.workId !== "string" || input.workId.length > 100
			|| !("visionIds" in input) || !Array.isArray(input.visionIds) || input.visionIds.length > 30
			|| !("selection" in input)) throw new Error("Choose a work and up to 30 saved Visions.");
		const ids: string[] = [];
		for (const id of input.visionIds)
		{
			if (typeof id !== "string" || id.length > 100) throw new Error("Invalid Vision identity.");
			ids.push(id);
		}
		const selection = input.selection === null ? null : DecodeTextSelection(input.selection);
		const scope: StudyScope = { workId: input.workId, visionIds: [...new Set(ids)], selection };
		this.starting = true;
		const generation = ++this.generation;
		let conversation: StudyConversation;
		try
		{
			this.session?.Dispose();
			try
			{
				await this.pending;
			}
			catch { /* The previous operation retains its own failure envelope. */ }
			const directivesPath = ResolveResourcePath("docs", "STUDY_PARTNER_DIRECTIVES.md");
			const directives = await fs.readFile(directivesPath, "utf8");
			if (generation !== this.generation) throw ApplicationError.Expected("cancelled", "STUDY_STOPPED", "Conversation stopped.");
			const backend = new GooseStudyBackend(process.env.CHORA_GOOSE_BINARY ?? "", path.join(this.internalPath, "goose"), directives);
			const evidence = new StudyEvidence(this.library.GetService(), this.visions.GetService(), this.visions.GetAnchors(), this.library.GetWords(), scope);
			const session = new StudySession(scope, value.model, backend, evidence, this.repository, directives, this.Publish.bind(this));
			this.session = session;
			this.BindSender(event.sender);
			conversation = await session.StartAsync();
		}
		finally
		{
			this.starting = false;
		}
		return conversation;
	}

	// Sends only to the captured conversation; changing tabs cannot retarget it.
	private async SendAsync(event: IpcMainInvokeEvent, id: unknown, text: unknown): Promise<StudyConversation>
	{
		this.RequireSender(event);
		const session = this.session;
		if (session === null || this.starting || this.pending !== null || id !== session.Snapshot().id || typeof text !== "string") throw new Error("Start a conversation and wait for its current response before sending another message.");
		const pending = session.SendAsync(text);
		this.pending = pending;
		let result: StudyConversation;
		try
		{
			result = await pending;
		}
		finally
		{
			if (this.pending === pending) this.pending = null;
		}
		return result;
	}

	// Stop is reader-initiated and always revokes the tool server.
	private async StopAsync(event: IpcMainInvokeEvent): Promise<void>
	{
		this.RequireSender(event);
		await this.DrainAsync();
	}

	// Returns passive history; restoring never reconnects or resubmits a turn.
	private async LoadAsync(event: IpcMainInvokeEvent): Promise<StudyConversation | null>
	{
		this.RequireSender(event);
		const result = await this.repository.LoadAsync();
		return result;
	}

	// Rejects other windows, subframes and stale renderer processes.
	private RequireSender(event: IpcMainInvokeEvent): void
	{
		const contents = this.windows.GetWindow()?.webContents;
		if (contents === undefined || event.sender !== contents || event.senderFrame !== contents.mainFrame) throw ApplicationError.Expected("validation", "UNTRUSTED_STUDY_REQUEST", "Untrusted interlocutor request.");
	}

	// Streaming sends bounded display facts, never provider credentials or raw tool results.
	private Publish(update: StudyUpdate): void
	{
		const contents = this.windows.GetWindow()?.webContents;
		if (contents !== undefined && !contents.isDestroyed()) contents.send(IPC_CHANNELS.studyUpdated, update);
	}

	// A renderer reload or crash revokes the current grant without creating replacement work.
	private RendererClosed(): void
	{
		this.generation += 1;
		this.session?.Dispose();
		this.session = null;
	}

	// In-page navigation is harmless; replacing the main frame ends the conversation runtime.
	private RendererNavigated(_event: Event, _url: string, isInPlace: boolean, isMainFrame: boolean): void
	{
		if (isMainFrame && !isInPlace) this.RendererClosed();
	}

	// Retains at most one set of window-lifetime subscriptions across conversations.
	private BindSender(sender: WebContents | null): void
	{
		if (this.sender !== sender)
		{
			this.sender?.removeListener("destroyed", this.rendererClosed);
			this.sender?.removeListener("render-process-gone", this.rendererClosed);
			this.sender?.removeListener("did-start-navigation", this.rendererNavigated);
			this.sender = sender;
			sender?.on("destroyed", this.rendererClosed);
			sender?.on("render-process-gone", this.rendererClosed);
			sender?.on("did-start-navigation", this.rendererNavigated);
		}
	}
}
