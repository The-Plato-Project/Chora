import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { AvailableModel } from "../../shared/models/ModelSelection.js";
import { ModelGateway } from "../models/ModelGateway.js";
import { ChatGateway } from "./ChatGateway.js";
import { ChatStore } from "./ChatStore.js";

// Coordinates generic conversations; feature owners supply save and selection behavior.
export class ChatController
{
	// Shares one store across remounts of this feature's chat tab.
	public constructor(public readonly Store: ChatStore, private readonly id: string, private readonly gateway: ChatGateway = new ChatGateway(), private readonly models: ModelGateway = new ModelGateway())
	{
	}
	// Opens saved history and offers only main-discovered model choices.
	public async OpenAsync(): Promise<readonly AvailableModel[]>
	{
		this.Store.Snapshot = await this.gateway.OpenAsync(this.id);
		const models = await this.models.ListModelsAsync();
		const remembered = this.Store.Model ?? this.Store.Snapshot?.model ?? null;
		let selected: AvailableModel | null = null;
		for (const model of models)
		{
			if (model.provider === remembered?.provider && model.model === remembered.model)
			{
				selected = model;
			}
		}
		this.Store.Model = selected ?? models[0] ?? null;
		return models;
	}
	// Retains the draft and request identity if transport, provider or persistence fails.
	public async SendAsync(selection: TextSelection | null, prepare: () => Promise<boolean>): Promise<void>
	{
		if (this.Store.Busy) throw new Error("A response is already in progress.");
		if (this.Store.Model === null) throw new Error("Choose an available model before sending.");
		const content = this.Store.Draft.trim();
		if (this.Store.RequestId === null || this.Store.RequestContent !== content)
		{
			this.Store.RequestId = crypto.randomUUID();
			this.Store.RequestContent = content;
		}
		const model = this.Store.Model;
		const requestId = this.Store.RequestId;
		this.Store.Pending = { id: requestId, content, status: "pending" };
		this.Store.Draft = "";
		this.Store.Busy = true;
		try
		{
			const saved = await prepare();
			if (!saved) throw new Error("Save the Dream successfully before sending a message.");
			this.Store.Snapshot = await this.gateway.SendAsync({ conversationId: this.id, clientRequestId: requestId, model, content, selection });
			this.Store.Pending = null;
			this.Store.RequestId = null;
		}
		catch (error)
		{
			this.Store.Pending = { id: requestId, content, status: "failed" };
			this.Store.Draft = content;
			try
			{
				this.Store.Snapshot = await this.gateway.OpenAsync(this.id);
			}
			catch
			{
				// Preserve the original send failure when transcript refresh also fails.
			}
			throw error;
		}
		finally
		{
			this.Store.Busy = false;
		}
	}
	// Cancels only the captured conversation, regardless of the active Dream tab.
	public async CancelAsync(): Promise<void>
	{
		await this.gateway.CancelAsync(this.id);
	}
}
