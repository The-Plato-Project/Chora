import type { OperationResult } from "../shared/diagnostics/OperationResult.js";
import type { ErrorRecord } from "../shared/diagnostics/DiagnosticManager.js";
import type { DreamTrashSnapshot } from "../shared/dreams/DreamTrashTypes.js";
import { contextBridge, ipcRenderer } from "electron";
import type { SelectionAction } from "../shared/text/TextSelection.js";
import type { TextDocument, LibraryTextSummary, SourceNotice } from "../shared/library/LibraryTypes.js";
import type { CreateDreamCommand, CreateDreamFolderCommand, DeleteDreamFolderCommand, DreamCatalogueSnapshot, DreamFolderSnapshot, DreamLocationSnapshot, DreamSnapshot, DreamSynopticViewRequest, MoveDreamCommand, UpdateDreamCommand } from "../shared/dreams/DreamTypes.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../shared/signals/SignalTypes.js";
import { IPC_CHANNELS } from "../shared/contracts/IpcChannels.js";
import type { ApiSubscription, ChoraApi, FormattingAction } from "../shared/contracts/ChoraApi.js";
import type { LookupBounds, LookupCommand, LookupState } from "../shared/library/LookupTypes.js";

async function ListLibraryTexts(): Promise<OperationResult<LibraryTextSummary[]>>
{
	const works = await ipcRenderer.invoke(IPC_CHANNELS.listLibraryTexts);
	return works as OperationResult<LibraryTextSummary[]>;
}

async function LoadLibraryText(workId: string): Promise<OperationResult<TextDocument>>
{
	const work = await ipcRenderer.invoke(IPC_CHANNELS.loadLibraryText, workId);
	return work as OperationResult<TextDocument>;
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

async function ShowSelectionContextMenu(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean): Promise<OperationResult<SelectionAction>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.showSelectionContextMenu, canAddSignal, canAddToDreamSource, canAddToCurrentSignal);
	return result as OperationResult<SelectionAction>;
}

async function ShowDreamSourceContextMenu(canAddToSelectedSignal: boolean): Promise<OperationResult<SelectionAction>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.showDreamSourceContextMenu, canAddToSelectedSignal);
	return result as OperationResult<SelectionAction>;
}

async function ShowFormattingContextMenu(): Promise<OperationResult<FormattingAction>>
{
	const result = await new Promise<OperationResult<FormattingAction>>(function AwaitNativeMenu(resolve): void
	{
		ipcRenderer.once(IPC_CHANNELS.showFormattingContextMenu, function ReceiveAction(_event, action: OperationResult<FormattingAction>): void
		{
			resolve(action);
		});
	});
	return result;
}

async function CopySelectedText(selectedText: string): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.copySelectedText, selectedText);
	return response as OperationResult<void>;
}

async function LookUpWord(selectedText: string): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.lookUpWord, selectedText);
	return response as OperationResult<void>;
}

// Reads dictionary state when the renderer mounts.
async function GetLookupState(): Promise<OperationResult<LookupState>>
{
	const state = await ipcRenderer.invoke(IPC_CHANNELS.getLookupState);
	return state as OperationResult<LookupState>;
}

// Places or hides the isolated dictionary view.
async function SetLookupBounds(bounds: LookupBounds | null): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.setLookupBounds, bounds);
	return response as OperationResult<void>;
}

// Sends a dictionary toolbar command.
async function ExecuteLookupCommand(command: LookupCommand): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.lookupCommand, command);
	return response as OperationResult<void>;
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

async function GetSourceNotice(workId: string): Promise<OperationResult<SourceNotice>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getSourceNotice, workId);
	return result as OperationResult<SourceNotice>;
}

async function CreateSignal(command: CreateSignalCommand): Promise<OperationResult<SignalRecord>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createSignal, command);

	return result as OperationResult<SignalRecord>;
}

async function UpdateSignal(command: UpdateSignalCommand): Promise<OperationResult<SignalRecord>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.updateSignal, command);

	return result as OperationResult<SignalRecord>;
}

async function DeleteSignal(command: DeleteSignalCommand): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.deleteSignal, command);
	return response as OperationResult<void>;
}

async function CreateDream(command: CreateDreamCommand): Promise<OperationResult<DreamSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createDream, command);

	return result as OperationResult<DreamSnapshot>;
}

async function UpdateDream(command: UpdateDreamCommand): Promise<OperationResult<DreamSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.updateDream, command);

	return result as OperationResult<DreamSnapshot>;
}

// Requests an explicit main-process filesystem reconciliation.
async function ReloadDreamCatalogue(): Promise<OperationResult<DreamCatalogueSnapshot>>
{
	const snapshot = await ipcRenderer.invoke(IPC_CHANNELS.reloadDreamCatalogue);

	return snapshot as OperationResult<DreamCatalogueSnapshot>;
}

async function ListDreamCatalogue(): Promise<OperationResult<DreamCatalogueSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listDreamCatalogue);

	return result as OperationResult<DreamCatalogueSnapshot>;
}

async function DeleteDream(dreamId: string): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.deleteDream, dreamId);
	return response as OperationResult<void>;
}

// Creates one filesystem-backed Dream folder.
async function CreateDreamFolder(command: CreateDreamFolderCommand): Promise<OperationResult<DreamFolderSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createDreamFolder, command);

	return result as OperationResult<DreamFolderSnapshot>;
}

// Deletes one empty filesystem-backed Dream folder.
async function DeleteDreamFolder(command: DeleteDreamFolderCommand): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.deleteDreamFolder, command);
	return response as OperationResult<void>;
}

// Moves one Dream to a folder within its work.
async function MoveDream(command: MoveDreamCommand): Promise<OperationResult<DreamLocationSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.moveDream, command);

	return result as OperationResult<DreamLocationSnapshot>;
}

async function CreateDreamSynopticView(request: DreamSynopticViewRequest): Promise<OperationResult<string>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createDreamSynopticView, request);

	return result as OperationResult<string>;
}

async function CancelDreamSynopticView(dreamId: string): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.cancelDreamSynopticView, dreamId);
	return response as OperationResult<void>;
}

// Invokes the narrow ListDreamTrash command.
async function ListDreamTrash(): Promise<OperationResult<readonly DreamTrashSnapshot[]>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listDreamTrash);
	return result as OperationResult<readonly DreamTrashSnapshot[]>;
}

// Invokes the narrow RestoreDreamTrash command.
async function RestoreDreamTrash(id: string): Promise<OperationResult<void>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.restoreDreamTrash, id);
	return result as OperationResult<void>;
}

// Invokes the narrow PurgeDreamTrash command.
async function PurgeDreamTrash(id: string): Promise<OperationResult<void>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.purgeDreamTrash, id);
	return result as OperationResult<void>;
}

// Invokes the narrow EmptyDreamTrash command.
async function EmptyDreamTrash(): Promise<OperationResult<void>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.emptyDreamTrash);
	return result as OperationResult<void>;
}

// Stores renderer diagnostics through a dedicated, validated endpoint.
async function RecordDiagnostic(record: ErrorRecord): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.recordDiagnostic, record);
	return response as OperationResult<void>;
}

// Delivers main-process notifications as plain diagnostic records.
function SubscribeDiagnostics(callback: (record: ErrorRecord) => void): ApiSubscription
{
	function Receive(_event: Electron.IpcRendererEvent, record: ErrorRecord): void
	{
		callback(record);
	}
	function Unsubscribe(): void
	{
		ipcRenderer.removeListener(IPC_CHANNELS.diagnosticReported, Receive);
	}
	const subscription = ipcRenderer.on(IPC_CHANNELS.diagnosticReported, Receive);
	void subscription;
	return Unsubscribe;
}

const api: ChoraApi = {
	RecordDiagnostic,
	SubscribeDiagnostics,
	ListLibraryTexts,
	LoadLibraryText,
	SubscribeLibraryTextSelected,
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
	CreateSignal,
	UpdateSignal,
	DeleteSignal,
	CreateDream,
	UpdateDream,
	DeleteDream,
	ListDreamTrash,
	RestoreDreamTrash,
	PurgeDreamTrash,
	EmptyDreamTrash,
	ReloadDreamCatalogue,
	ListDreamCatalogue,
	CreateDreamFolder,
	DeleteDreamFolder,
	MoveDream,
	CreateDreamSynopticView,
	CancelDreamSynopticView
};

contextBridge.exposeInMainWorld("chora", api);
