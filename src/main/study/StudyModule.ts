import { ipcMain, type IpcMainInvokeEvent, type WebContents, type Event } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { StudyConversation, StudySendCommand, StudyUpdate } from "../../shared/study/StudyTypes.js";
import type { ChoraWindowManager } from "../bootstrap/WindowManager.js";
import { ResolveResourcePath } from "../bootstrap/ResourcePaths.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import type { LibraryModule } from "../library/LibraryModule.js";
import type { VisionModule } from "../visions/VisionModule.js";
import { StudyConversationRepository } from "./StudyConversationRepository.js";
import { StudyEvidence } from "./StudyEvidence.js";
import { StudySession } from "./StudySession.js";
import { GooseStudyBackend } from "./goose/GooseStudyBackend.js";

// Optional work-scoped chat boundary; ordinary Send owns lazy backend startup.
export class StudyModule
{
	// Only the work currently receiving requests has a live backend.
	private session: StudySession | null = null;
	// History is persisted separately for each canonical work.
	private readonly repository: StudyConversationRepository;
	// Admitted work includes startup, generation and the final history write.
	private pending: Promise<StudyConversation> | null = null;
	// Cancellation names the captured work rather than the active renderer tab.
	private pendingWorkId: string | null = null;
	// Revokes startup that was awaiting an external read when Stop arrived.
	private generation = 0;
	// One renderer lifetime binding is retained across messages.
	private sender: WebContents | null = null;
	// Stable listener identities permit complete teardown.
	private readonly rendererClosed = this.RendererClosed.bind(this);
	private readonly rendererNavigated = this.RendererNavigated.bind(this);

	// Existing service owners retain all canonical and reader-document responsibilities.
	public constructor(private readonly windows: ChoraWindowManager, private readonly library: LibraryModule,
		private readonly visions: VisionModule, private readonly internalPath: string)
	{
		this.repository = new StudyConversationRepository(path.join(internalPath, "interlocutor"));
	}

	// No start-session or context-selection API is exposed to the renderer.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.studySend, this.SendAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.studyStop, this.StopAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.studyHistory, this.LoadAsync.bind(this));
	}

	// Revokes transport and listeners when removing the optional feature.
	public Unregister(): void
	{
		this.generation += 1;
		this.BindSender(null);
		this.session?.Dispose();
		this.session = null;
		for (const channel of [IPC_CHANNELS.studySend, IPC_CHANNELS.studyStop, IPC_CHANNELS.studyHistory]) ipcMain.removeHandler(channel);
	}

	// Completes the captured turn's partial-history write before shutdown.
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
			try { await this.pending; }
			catch { /* The admitted IPC operation owns its failure envelope. */ }
		}
	}

	// Validates one ordinary message and captures its work before awaiting anything.
	private async SendAsync(event: IpcMainInvokeEvent, value: unknown): Promise<StudyConversation>
	{
		this.RequireSender(event);
		const command = this.Decode(value);
		if (this.pending !== null) throw ApplicationError.Expected("conflict", "STUDY_BUSY", "Wait for the current response or stop it first.");
		this.BindSender(event.sender);
		this.pendingWorkId = command.workId;
		const pending = this.ExecuteAsync(command);
		this.pending = pending;
		let result: StudyConversation;
		try { result = await pending; }
		finally
		{
			if (this.pending === pending)
			{
				this.pending = null;
				this.pendingWorkId = null;
			}
		}
		return result;
	}

	// Opens execution only for an explicit message, restoring history as context without replay.
	private async ExecuteAsync(command: StudySendCommand): Promise<StudyConversation>
	{
		const generation = this.generation;
		await this.library.GetService().GetAsync(command.workId);
		if (generation !== this.generation) throw ApplicationError.Expected("cancelled", "STUDY_STOPPED", "Response stopped.");
		let result: StudyConversation;
		try
		{
			const current = this.session?.Snapshot();
			if (this.session === null || current?.scope.workId !== command.workId || current?.model !== command.model)
			{
				this.session?.Dispose();
				this.session = null;
				const previous = await this.repository.LoadAsync(command.workId);
				const directivesPath = ResolveResourcePath("docs", "STUDY_PARTNER_DIRECTIVES.md");
				const directives = await fs.readFile(directivesPath, "utf8");
				if (generation !== this.generation) throw ApplicationError.Expected("cancelled", "STUDY_STOPPED", "Response stopped.");
				const scope = { workId: command.workId };
				const backend = new GooseStudyBackend(process.env.CHORA_GOOSE_BINARY ?? "", path.join(this.internalPath, "goose"), directives);
				const evidence = new StudyEvidence(this.library.GetService(), this.visions.GetService(), this.visions.GetAnchors(), this.library.GetWords(), scope);
				const session = new StudySession(scope, command.model, backend, evidence, this.repository, directives, this.Publish.bind(this), previous);
				this.session = session;
				await session.StartAsync();
			}
			const session = this.session;
			if (session === null || generation !== this.generation) throw ApplicationError.Expected("cancelled", "STUDY_STOPPED", "Response stopped.");
			result = await session.SendAsync(command.text, command.visionId);
		}
		catch (error)
		{
			this.session?.Dispose();
			this.session = null;
			throw error;
		}
		return result;
	}

	// A stale Stop from a previous work cannot cancel a new work's response.
	private async StopAsync(event: IpcMainInvokeEvent, workId: unknown): Promise<void>
	{
		this.RequireSender(event);
		if (typeof workId !== "string") throw ApplicationError.Expected("validation", "INVALID_STUDY_WORK", "The chat work is invalid.");
		if (this.pendingWorkId === workId || this.session?.Snapshot().scope.workId === workId) await this.DrainAsync();
	}

	// Changing works restores display history without starting a model or performing a task.
	private async LoadAsync(event: IpcMainInvokeEvent, workId: unknown): Promise<StudyConversation | null>
	{
		this.RequireSender(event);
		if (typeof workId !== "string" || workId.length > 100) throw ApplicationError.Expected("validation", "INVALID_STUDY_WORK", "The chat work is invalid.");
		await this.library.GetService().GetAsync(workId);
		const result = await this.repository.LoadAsync(workId);
		return result;
	}

	// Rejects arbitrary paths, unsupported models and oversized requests at the IPC boundary.
	private Decode(value: unknown): StudySendCommand
	{
		if (typeof value !== "object" || value === null || !("workId" in value) || typeof value.workId !== "string" || value.workId.length > 100
			|| !("text" in value) || typeof value.text !== "string" || value.text.trim().length === 0 || value.text.length > 8000
			|| !("visionId" in value) || (value.visionId !== null && (typeof value.visionId !== "string" || value.visionId.length > 100))
			|| !("model" in value) || (value.model !== "qwen3.5:9b" && value.model !== "qwen3.5:4b"))
		{
			throw ApplicationError.Expected("validation", "INVALID_STUDY_MESSAGE", "Enter a message for the current work and choose a supported model in Chora settings.");
		}
		const command: StudySendCommand = { workId: value.workId, text: value.text, visionId: value.visionId, model: value.model };
		return command;
	}

	// Only the trusted application's main frame may use the chat boundary.
	private RequireSender(event: IpcMainInvokeEvent): void
	{
		const contents = this.windows.GetWindow()?.webContents;
		if (contents === undefined || event.sender !== contents || event.senderFrame !== contents.mainFrame) throw ApplicationError.Expected("validation", "UNTRUSTED_STUDY_REQUEST", "Untrusted chat request.");
	}

	// Streams only application-owned display facts, tagged with their originating work.
	private Publish(update: StudyUpdate): void
	{
		const contents = this.windows.GetWindow()?.webContents;
		if (contents !== undefined && !contents.isDestroyed()) contents.send(IPC_CHANNELS.studyUpdated, update);
	}

	// Window loss revokes all execution, including startup currently awaiting I/O.
	private RendererClosed(): void
	{
		this.generation += 1;
		this.session?.Dispose();
		this.session = null;
	}

	// Replacing the main document ends execution; in-page navigation does not.
	private RendererNavigated(_event: Event, _url: string, isInPlace: boolean, isMainFrame: boolean): void
	{
		if (isMainFrame && !isInPlace) this.RendererClosed();
	}

	// Retains one removable renderer lifetime binding across work changes.
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
