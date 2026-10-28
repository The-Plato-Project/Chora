import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { DreamSynopticViewRequest } from "../../shared/dreams/DreamTypes.js";
import type { ModelProvider } from "../../shared/models/ModelTypes.js";
import { PromptLoader } from "../prompts/PromptLoader.js";
import { CreateModelProvider } from "../models/ModelProviderFactory.js";

export type SynopticViewProviderFactory = () => ModelProvider;

export class DreamSynopticViewService
{
	private readonly activeRequests = new Map<string, AbortController>();

	public constructor(
		private readonly prompts: PromptLoader = new PromptLoader(),
		private readonly createProvider: SynopticViewProviderFactory = CreateModelProvider)
	{
	}

	public async CreateAsync(request: DreamSynopticViewRequest): Promise<string>
	{
		const dreamId = request.dreamId.trim();
		const readingDocument = request.readingDocument.trim();
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(dreamId)) throw ApplicationError.Expected("validation", "INVALID_CLARITY_REQUEST", "Dream identifier is invalid.");
		if (readingDocument.length === 0) throw ApplicationError.Expected("validation", "INVALID_CLARITY_REQUEST", "The Dream has no reading material for a Clarity Check.");
		if (this.activeRequests.has(dreamId)) throw ApplicationError.Expected("conflict", "INVALID_CLARITY_REQUEST", "A Clarity Check is already being generated for this Dream.");

		const controller = new AbortController();
		this.activeRequests.set(dreamId, controller);
		try
		{
			const systemPrompt = await this.prompts.LoadAsync("clarity-check");
			const userPrompt = `<reading_document>\n${readingDocument}\n</reading_document>`;
			const provider = this.createProvider();
			const response = await provider.CompleteAsync({ systemPrompt, userPrompt, history: [] }, undefined, controller.signal);
			const synopticView = response.rawText.trim();
			if (synopticView.length === 0) throw ApplicationError.Expected("validation", "INVALID_CLARITY_REQUEST", "The model returned an empty Clarity Check.");
			return synopticView;
		}
		catch (error)
		{
			if (controller.signal.aborted) throw ApplicationError.Expected("cancelled", "CLARITY_CANCELLED", "The Clarity Check was cancelled.");
			throw error;
		}
		finally
		{
			this.activeRequests.delete(dreamId);
		}
	}

	public Cancel(dreamId: string): void
	{
		this.activeRequests.get(dreamId)?.abort();
	}

	public Stop(): void
	{
		for (const request of this.activeRequests.values()) request.abort();
		this.activeRequests.clear();
	}
}
