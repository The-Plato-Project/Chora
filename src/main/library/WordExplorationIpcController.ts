import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { WordEvidenceResult, WordNameNote, WordObservation, WordPersonResearch, WordSearchResult } from "../../shared/library/WordExplorationTypes.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { WordExplorationService } from "./WordExplorationService.js";

const RESEARCH_SOURCE_HOSTS = new Set([
	"humanisticadigitalia.eu",
	"athnames.org",
	"www.perseus.tufts.edu"
]);

export function ParseResearchSourceUrl(value: unknown): URL
{
	if (typeof value !== "string")
	{
		throw new Error("External source URL must be text.");
	}
	const url = new URL(value);
	if (url.protocol !== "https:" || !RESEARCH_SOURCE_HOSTS.has(url.hostname))
	{
		throw new Error("External source URL is not allowed.");
	}
	return url;
}

export class WordExplorationIpcController
{
	public constructor(private readonly service: WordExplorationService)
	{
	}

	public Register(): void
	{
		const search = this.SearchAsync.bind(this);
		const evidence = this.GetEvidenceAsync.bind(this);
		const person = this.GetPersonResearchAsync.bind(this);
		const getNameNote = this.GetNameNoteAsync.bind(this);
		const saveNameNote = this.SaveNameNoteAsync.bind(this);
		const openExternal = this.OpenExternalSourceAsync.bind(this);
		const getObservation = this.GetObservationAsync.bind(this);
		const saveObservation = this.SaveObservationAsync.bind(this);
		IpcErrorBoundary.Register(IPC_CHANNELS.searchWord, search);
		IpcErrorBoundary.Register(IPC_CHANNELS.getWordEvidence, evidence);
		IpcErrorBoundary.Register(IPC_CHANNELS.getPersonResearch, person);
		IpcErrorBoundary.Register(IPC_CHANNELS.getWordNameNote, getNameNote);
		IpcErrorBoundary.Register(IPC_CHANNELS.saveWordNameNote, saveNameNote);
		IpcErrorBoundary.Register(IPC_CHANNELS.openExternalSource, openExternal);
		IpcErrorBoundary.Register(IPC_CHANNELS.getWordObservation, getObservation);
		IpcErrorBoundary.Register(IPC_CHANNELS.saveWordObservation, saveObservation);
	}

	public Unregister(): void
	{
		ipcMain.removeHandler(IPC_CHANNELS.searchWord);
		ipcMain.removeHandler(IPC_CHANNELS.getWordEvidence);
		ipcMain.removeHandler(IPC_CHANNELS.getPersonResearch);
		ipcMain.removeHandler(IPC_CHANNELS.getWordNameNote);
		ipcMain.removeHandler(IPC_CHANNELS.saveWordNameNote);
		ipcMain.removeHandler(IPC_CHANNELS.openExternalSource);
		ipcMain.removeHandler(IPC_CHANNELS.getWordObservation);
		ipcMain.removeHandler(IPC_CHANNELS.saveWordObservation);
	}

	private async GetNameNoteAsync(
		_event: IpcMainInvokeEvent,
		key: unknown): Promise<WordNameNote>
	{
		return this.service.GetNameNoteAsync(key);
	}

	private async SaveNameNoteAsync(
		_event: IpcMainInvokeEvent,
		note: unknown): Promise<WordNameNote>
	{
		return this.service.SaveNameNoteAsync(note);
	}

	private async SearchAsync(_event: IpcMainInvokeEvent, workId: unknown, form: unknown): Promise<WordSearchResult>
	{
		const result = await this.service.SearchAsync(workId, form);
		return result;
	}

	private async GetEvidenceAsync(_event: IpcMainInvokeEvent, selection: unknown): Promise<WordEvidenceResult>
	{
		return this.service.GetEvidenceAsync(selection);
	}

	private async GetPersonResearchAsync(
		_event: IpcMainInvokeEvent,
		selection: unknown,
		lemma: unknown): Promise<WordPersonResearch>
	{
		return this.service.GetPersonResearchAsync(selection, lemma);
	}

	private async OpenExternalSourceAsync(_event: IpcMainInvokeEvent, value: unknown): Promise<void>
	{
		const url = ParseResearchSourceUrl(value);
		await shell.openExternal(url.toString());
	}

	private async GetObservationAsync(_event: IpcMainInvokeEvent, key: unknown): Promise<WordObservation>
	{
		return this.service.GetObservationAsync(key);
	}

	private async SaveObservationAsync(_event: IpcMainInvokeEvent, observation: unknown): Promise<WordObservation>
	{
		return this.service.SaveObservationAsync(observation);
	}
}
