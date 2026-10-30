import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ChatConversationSnapshot } from "../../shared/chat/ChatTypes.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import type { ChatService } from "./ChatService.js";

// Narrow IPC boundary for reusable conversations; no prompts or paths cross from renderer.
export class ChatIpcController
{
	// Shares the lifecycle-owned conversation executor.
	public constructor(private readonly service: ChatService)
	{
	}
	// Installs commands using the existing failure envelope and diagnostics.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.openChat, this.OpenAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.sendChat, this.SendAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.cancelChat, this.Cancel.bind(this));
	}
	// Removes handlers and cancels active provider work.
	public Unregister(): void
	{
		ipcMain.removeHandler(IPC_CHANNELS.openChat);
		ipcMain.removeHandler(IPC_CHANNELS.sendChat);
		ipcMain.removeHandler(IPC_CHANNELS.cancelChat);
		this.service.Stop();
	}
	// Loads a conversation for a validated canonical feature identity.
	private async OpenAsync(_event: IpcMainInvokeEvent, id: unknown): Promise<ChatConversationSnapshot | null>
	{
		const snapshot = await this.service.OpenAsync(id);
		return snapshot;
	}
	// Sends a reader turn through runtime command validation.
	private async SendAsync(_event: IpcMainInvokeEvent, command: unknown): Promise<ChatConversationSnapshot>
	{
		const snapshot = await this.service.SendAsync(command);
		return snapshot;
	}
	// Cancels provider work without waiting on conversation persistence locks.
	private Cancel(_event: IpcMainInvokeEvent, id: unknown): void
	{
		this.service.Cancel(id);
	}
}
