import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";

// Renderer-owned editable projection that resolves a Dream's canonical Signal identities for display.
export interface DreamView
{
	id: string;
	workId: string;
	dialogue: string | null;
	title: string;
	source: DreamSnapshot["source"];
	signalIds: string[];
	signals: SignalRecord[];
	reflection: string;
	synopticView: string;
	linkedDreamIds: string[];
	createdAt: string;
	updatedAt: string;
}

// Creates one renderer projection from a serialized Dream and canonical Signal snapshots.
export function CreateDreamView(snapshot: DreamSnapshot, signals: readonly SignalRecord[]): DreamView
{
	const associated = signals.filter(function IsAssociated(signal): boolean
	{
		return snapshot.signalIds.includes(signal.id);
	});
	const view: DreamView = {
		...structuredClone(snapshot),
		signalIds: [...snapshot.signalIds],
		linkedDreamIds: [...snapshot.linkedDreamIds],
		signals: structuredClone(associated)
	};

	return view;
}

// Removes renderer-only resolved Signal snapshots before crossing an IPC or persistence boundary.
export function CreateDreamSnapshot(view: DreamView): DreamSnapshot
{
	const snapshot: DreamSnapshot = {
		id: view.id,
		workId: view.workId,
		dialogue: view.dialogue,
		title: view.title,
		source: structuredClone(view.source),
		signalIds: [...view.signalIds],
		reflection: view.reflection,
		synopticView: view.synopticView,
		linkedDreamIds: [...view.linkedDreamIds],
		createdAt: view.createdAt,
		updatedAt: view.updatedAt
	};

	return snapshot;
}
