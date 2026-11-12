import type { OperationResult } from "../shared/diagnostics/OperationResult.js";
import type { ErrorRecord } from "../shared/diagnostics/DiagnosticManager.js";
import type { WordLexicalSearchResult } from "../shared/library/WordExplorationTypes.js";
import { contextBridge, ipcRenderer } from "electron";
import type { SelectionAction, TextSelection } from "../shared/text/TextSelection.js";
import type { TextDocument, LibraryTextSummary, SourceNotice } from "../shared/library/LibraryTypes.js";
import type {
	CreateVisionCommand,
	CreateVisionFolderCommand,
	DeleteVisionFolderCommand,
	MoveVisionCommand,
	UpdateVisionCommand,
	VisionCatalogueSnapshot,
	VisionFolderSnapshot,
	VisionSnapshot
} from "../shared/visions/VisionTypes.js";
import type { CreateTextAnchorCommand, TextAnchorSnapshot } from "../shared/anchors/TextAnchorTypes.js";
import { IPC_CHANNELS } from "../shared/contracts/IpcChannels.js";
import type { ApiSubscription, ApplicationMenuCommand, ChoraApi, FormattingAction, VisionReferenceAction } from "../shared/contracts/ChoraApi.js";
import type {
	WordEvidenceResult,
	WordNameNote,
	WordNameNoteKey,
	WordObservation,
	WordObservationKey,
	WordPersonResearch,
	WordSearchResult
} from "../shared/library/WordExplorationTypes.js";
import type { VisionReferenceDragPayload } from "../shared/visions/VisionReferenceTypes.js";

async function SearchWord(workId: string, form: string): Promise<OperationResult<WordSearchResult>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.searchWord, workId, form);
	return result as OperationResult<WordSearchResult>;
}

async function GetWordEvidence(selection: TextSelection): Promise<OperationResult<WordEvidenceResult>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getWordEvidence, selection);
	return result as OperationResult<WordEvidenceResult>;
}

async function GetPersonResearch(
	selection: TextSelection,
	lemma: string): Promise<OperationResult<WordPersonResearch>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getPersonResearch, selection, lemma);
	return result as OperationResult<WordPersonResearch>;
}

async function GetWordNameNote(key: WordNameNoteKey): Promise<OperationResult<WordNameNote>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getWordNameNote, key);
	return result as OperationResult<WordNameNote>;
}

async function SaveWordNameNote(note: WordNameNote): Promise<OperationResult<WordNameNote>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.saveWordNameNote, note);
	return result as OperationResult<WordNameNote>;
}

async function OpenExternalSource(url: string): Promise<OperationResult<void>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.openExternalSource, url);
	return result as OperationResult<void>;
}

async function GetWordObservation(key: WordObservationKey): Promise<OperationResult<WordObservation>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getWordObservation, key);
	return result as OperationResult<WordObservation>;
}

async function SaveWordObservation(observation: WordObservation): Promise<OperationResult<WordObservation>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.saveWordObservation, observation);
	return result as OperationResult<WordObservation>;
}

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

async function ShowSelectionContextMenu(canExploreWord: boolean): Promise<OperationResult<SelectionAction>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.showSelectionContextMenu, canExploreWord);
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

async function ShowVisionReferenceContextMenu(canExploreWord: boolean): Promise<OperationResult<VisionReferenceAction>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.showVisionReferenceContextMenu, canExploreWord);
	return result as OperationResult<VisionReferenceAction>;
}

async function CopySelectedText(selectedText: string): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.copySelectedText, selectedText);
	return response as OperationResult<void>;
}

async function CopySelectionAnchor(payload: VisionReferenceDragPayload): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.copySelectionAnchor, payload);
	return response as OperationResult<void>;
}

async function GetSourceNotice(workId: string): Promise<OperationResult<SourceNotice>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.getSourceNotice, workId);
	return result as OperationResult<SourceNotice>;
}

async function CreateVision(command: CreateVisionCommand): Promise<OperationResult<VisionSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createVision, command);
	return result as OperationResult<VisionSnapshot>;
}

async function UpdateVision(command: UpdateVisionCommand): Promise<OperationResult<VisionSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.updateVision, command);
	return result as OperationResult<VisionSnapshot>;
}

async function DeleteVision(visionId: string): Promise<OperationResult<void>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.deleteVision, visionId);
	return result as OperationResult<void>;
}

async function ListVisions(): Promise<OperationResult<VisionCatalogueSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listVisions);
	return result as OperationResult<VisionCatalogueSnapshot>;
}

async function CreateVisionFolder(command: CreateVisionFolderCommand): Promise<OperationResult<VisionFolderSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createVisionFolder, command);
	return result as OperationResult<VisionFolderSnapshot>;
}

async function DeleteVisionFolder(command: DeleteVisionFolderCommand): Promise<OperationResult<void>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.deleteVisionFolder, command);
	return result as OperationResult<void>;
}

async function MoveVision(command: MoveVisionCommand): Promise<OperationResult<VisionSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.moveVision, command);
	return result as OperationResult<VisionSnapshot>;
}

async function CreateTextAnchor(command: CreateTextAnchorCommand): Promise<OperationResult<TextAnchorSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.createTextAnchor, command);
	return result as OperationResult<TextAnchorSnapshot>;
}

async function ListTextAnchors(workId: string): Promise<OperationResult<readonly TextAnchorSnapshot[]>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.listTextAnchors, workId);
	return result as OperationResult<readonly TextAnchorSnapshot[]>;
}

async function ValidateTextAnchor(anchorId: string): Promise<OperationResult<TextAnchorSnapshot>>
{
	const result = await ipcRenderer.invoke(IPC_CHANNELS.validateTextAnchor, anchorId);
	return result as OperationResult<TextAnchorSnapshot>;
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

// Forwards bounded lexical requests without granting the renderer provider access.
async function SearchLexicon(query: string): Promise<OperationResult<WordLexicalSearchResult>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.searchLexicon, query);
	return response as OperationResult<WordLexicalSearchResult>;
}

// A lexical tab can optionally display occurrences in an owner-resolved work.
async function GetLexicalEvidence(lemma: string, workId: string | null): Promise<OperationResult<WordEvidenceResult>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.getLexicalEvidence, lemma, workId);
	return response as OperationResult<WordEvidenceResult>;
}

// Delivers native settings commands through the deliberately narrow preload bridge.
function SubscribeSettingsRequested(callback: () => void): ApiSubscription
{
	function Receive(): void
	{
		callback();
	}
	function Unsubscribe(): void
	{
		ipcRenderer.removeListener(IPC_CHANNELS.openSettings, Receive);
	}
	ipcRenderer.on(IPC_CHANNELS.openSettings, Receive);
	return Unsubscribe;
}

// Passes only the explicit application theme across the isolated bridge.
async function SetAppearance(appearance: "light" | "dark", selectionColor: string): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.setAppearance, appearance, selectionColor);
	return response as OperationResult<void>;
}

// Forwards only named menu actions through the isolated application boundary.
async function ExecuteApplicationMenuCommand(command: ApplicationMenuCommand): Promise<OperationResult<void>>
{
	const response = await ipcRenderer.invoke(IPC_CHANNELS.applicationMenuCommand, command);
	return response as OperationResult<void>;
}

const api: ChoraApi = {
	UsesNativeMenu: process.platform === "darwin",
	ExecuteApplicationMenuCommand,
	SetAppearance,
	SubscribeSettingsRequested,
	SearchLexicon,
	GetLexicalEvidence,
	RecordDiagnostic,
	SubscribeDiagnostics,
	ListLibraryTexts,
	LoadLibraryText,
	SubscribeLibraryTextSelected,
	ShowSelectionContextMenu,
	ShowFormattingContextMenu,
	ShowVisionReferenceContextMenu,
	CopySelectedText,
	CopySelectionAnchor,
	GetSourceNotice,
	SearchWord,
	GetWordEvidence,
	GetPersonResearch,
	GetWordNameNote,
	SaveWordNameNote,
	OpenExternalSource,
	GetWordObservation,
	SaveWordObservation,
	CreateVision,
	UpdateVision,
	DeleteVision,
	ListVisions,
	CreateVisionFolder,
	DeleteVisionFolder,
	MoveVision,
	CreateTextAnchor,
	ListTextAnchors,
	ValidateTextAnchor
};

contextBridge.exposeInMainWorld("chora", api);
