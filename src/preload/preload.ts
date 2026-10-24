import { contextBridge, ipcRenderer } from "electron";
import type { SelectionAction } from "../shared/text/TextSelection.js";
import type { TextDocument, LibraryTextSummary, SourceNotice } from "../shared/library/LibraryTypes.js";
import type { DreamSnapshot, DreamSynopticViewRequest } from "../shared/dreams/DreamTypes.js";
import type { DeleteSignalCommand, SaveSignalCommand, SignalRecord } from "../shared/signals/SignalTypes.js";
import type { DeleteIdeaCommand, IdeaDiscoveryRequest, IdeaDiscoverySuggestion, IdeaRecord, SaveIdeaCommand } from "../shared/ideas/IdeaTypes.js";
import { IPC_CHANNELS } from "../shared/contracts/IpcChannels.js";
import type { ApiSubscription, ChoraApi, FormattingAction } from "../shared/contracts/ChoraApi.js";
import type { LookupBounds, LookupCommand, LookupState } from "../shared/library/LookupTypes.js";

async function ListLibraryTexts(): Promise<LibraryTextSummary[]>
{
	const works = await ipcRenderer.invoke(IPC_CHANNELS.listLibraryTexts);
	return works as LibraryTextSummary[];
}

async function LoadLibraryText(workId: string): Promise<TextDocument>
{
	const work = await ipcRenderer.invoke(IPC_CHANNELS.loadLibraryText, workId);
	return work as TextDocument;
}

function SubscribeLibraryTextSelected(callback: (workId: string) => void): ApiSubscription
{
	const listener = (_event: Electron.IpcRendererEvent, workId: unknown): void =>
	{
		callback(workId as string);
	};
	ipcRenderer.on(IPC_CHANNELS.selectLibraryText, listener);
	return () => ipcRenderer.removeListener(IPC_CHANNELS.selectLibraryText, listener);
}

function SubscribeExternalTextLoaded(callback: (work: TextDocument) => void): ApiSubscription
{
	const listener = (_event: Electron.IpcRendererEvent, work: unknown): void =>
	{
		callback(work as TextDocument);
	};
	ipcRenderer.on(IPC_CHANNELS.externalTextLoaded, listener);
	return () => ipcRenderer.removeListener(IPC_CHANNELS.externalTextLoaded, listener);
}

async function ShowSelectionContextMenu(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean): Promise<SelectionAction>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.showSelectionContextMenu, canAddSignal, canAddToDreamSource, canAddToCurrentSignal);
	return result as SelectionAction;
}

async function ShowDreamSourceContextMenu(canAddToSelectedSignal: boolean): Promise<SelectionAction>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.showDreamSourceContextMenu, canAddToSelectedSignal);
	return result as SelectionAction;
}

async function ShowFormattingContextMenu(): Promise<FormattingAction>
{
	const result = await new Promise<FormattingAction>(function AwaitNativeMenu(resolve): void
	{
		ipcRenderer.once(IPC_CHANNELS.showFormattingContextMenu, function ReceiveAction(_event, action: FormattingAction): void
		{
			resolve(action);
		});
	});
	return result;
}

async function CopySelectedText(selectedText: string): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.copySelectedText, selectedText);
}

async function LookUpWord(selectedText: string): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.lookUpWord, selectedText);
}

// Reads dictionary state when the renderer mounts.
async function GetLookupState(): Promise<LookupState>
{
	const state = await ipcRenderer.invoke(IPC_CHANNELS.getLookupState);
	return state as LookupState;
}

// Places or hides the isolated dictionary view.
async function SetLookupBounds(bounds: LookupBounds | null): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.setLookupBounds, bounds);
}

// Sends a dictionary toolbar command.
async function ExecuteLookupCommand(command: LookupCommand): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.lookupCommand, command);
}

// Subscribes to dictionary navigation and loading state.
function SubscribeLookupState(callback: (state: LookupState) => void): ApiSubscription
{
	function ReceiveState(_event: Electron.IpcRendererEvent, state: LookupState): void
	{
		callback(state);
	}
	function Unsubscribe(): void
	{
		ipcRenderer.removeListener(IPC_CHANNELS.lookupStateChanged, ReceiveState);
	}
	ipcRenderer.on(IPC_CHANNELS.lookupStateChanged, ReceiveState);
	return Unsubscribe;
}

async function GetSourceNotice(workId: string): Promise<SourceNotice>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getSourceNotice, workId);
	return result as SourceNotice;
}

async function ListSignals(workId: string): Promise<SignalRecord[]>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listSignals, workId);

	return result as SignalRecord[];
}

async function SaveSignal(command: SaveSignalCommand): Promise<SignalRecord>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.saveSignal, command);

	return result as SignalRecord;
}

async function DeleteSignal(command: DeleteSignalCommand): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.deleteSignal, command);
}

// Lists durable Ideas through the isolated renderer bridge.
async function ListIdeas(workId: string): Promise<IdeaRecord[]>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listIdeas, workId);

	return result as IdeaRecord[];
}

// Discovers related existing Signals through the isolated renderer bridge.
async function DiscoverIdeaSignals(request: IdeaDiscoveryRequest): Promise<IdeaDiscoverySuggestion[]>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.discoverIdeaSignals, request);

	return result as IdeaDiscoverySuggestion[];
}

// Saves reader-editable Idea data through the isolated renderer bridge.
async function SaveIdea(command: SaveIdeaCommand): Promise<IdeaRecord>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.saveIdea, command);

	return result as IdeaRecord;
}

// Deletes one work-owned Idea through the isolated renderer bridge.
async function DeleteIdea(command: DeleteIdeaCommand): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.deleteIdea, command);
}

async function SaveDream(dream: DreamSnapshot): Promise<DreamSnapshot>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.saveDream, dream);

	return result as DreamSnapshot;
}

async function ListDreams(): Promise<DreamSnapshot[]>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listDreams);

	return result as DreamSnapshot[];
}

async function DeleteDream(dreamId: string): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.deleteDream, dreamId);
}

async function AllocateDreamId(): Promise<string>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.allocateDreamId);

	return result as string;
}

async function CreateDreamSynopticView(request: DreamSynopticViewRequest): Promise<string>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createDreamSynopticView, request);

	return result as string;
}

async function CancelDreamSynopticView(dreamId: string): Promise<void>
{
	await ipcRenderer.invoke(IPC_CHANNELS.cancelDreamSynopticView, dreamId);
}

const api: ChoraApi = {
	ListLibraryTexts,
	LoadLibraryText,
	SubscribeLibraryTextSelected,
	SubscribeExternalTextLoaded,
	ShowSelectionContextMenu,
	ShowDreamSourceContextMenu,
	ShowFormattingContextMenu,
	CopySelectedText,
	LookUpWord,
	GetLookupState,
	SetLookupBounds,
	ExecuteLookupCommand,
	SubscribeLookupState,
	GetSourceNotice,
	ListSignals,
	SaveSignal,
	DeleteSignal,
	ListIdeas,
	DiscoverIdeaSignals,
	SaveIdea,
	DeleteIdea,
	SaveDream,
	DeleteDream,
	ListDreams,
	AllocateDreamId,
	CreateDreamSynopticView,
	CancelDreamSynopticView
};

contextBridge.exposeInMainWorld("chora", api);
