import type { DreamSaveCoordinator } from "./DreamSaveCoordinator.js";
import type { DreamStore } from "./DreamStore.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import { ChatPanel } from "../chat/ChatPanel.js";
import { ChatStore } from "../chat/ChatStore.js";
import { TabPanel } from "../ui/TabPanel.js";

// Integrates canonical Dream saving and explicit selection with reusable Chat UI.
export class DreamDiscussionPanel extends TabPanel
{
	// Reusable conversation UI, independent of Dream editing commands.
	private readonly chat: ChatPanel;
	// Captured identity prevents sending another Dream's unsaved state after a tab switch.
	private readonly dreamId: string;

	// Mounts a real conversation in the Clarity Check tab.
	public constructor(dreamId: string, state: ChatStore, private readonly saves: DreamSaveCoordinator, private readonly dreams: DreamStore, private readonly library: LibraryStore, errors: ErrorManager)
	{
		super("clarity-check", "Chora SI");
		this.dreamId = dreamId;
		this.Root.classList.add("dream-discussion-tab");
		this.chat = new ChatPanel(dreamId, state, errors, this.PrepareAsync.bind(this), this.GetSelection.bind(this));
		this.Root.append(this.chat.Root);
	}

	// Opens provider discovery only when the reader enters Clarity Check.
	public override OnSelected(): void
	{
		this.chat.Start();
	}

	// Saves the captured Dream before main resolves its canonical discussion material.
	private async PrepareAsync(): Promise<boolean>
	{
		let saved = false;
		if (this.dreams.GetActiveDream()?.id === this.dreamId)
		{
			saved = await this.saves.SaveAsync();
			saved = saved && this.dreams.GetActiveDream()?.id === this.dreamId;
		}
		return saved;
	}

	// Captures only an explicit reader selection from the active Library text.
	private GetSelection(): TextSelection | null
	{
		const selection = this.library.GetSelection();
		return selection;
	}

	// Releases the local surface; persisted model work continues independently of tab rendering.
	public override Dispose(): void
	{
		this.chat.Dispose();
		super.Dispose();
	}
}
