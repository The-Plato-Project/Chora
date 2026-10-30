import type { AvailableModel, ModelSelection } from "../../shared/models/ModelSelection.js";
import type { ModelDeltaHandler, ModelRequest, ModelResponse, ProviderId } from "../../shared/models/ModelTypes.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { CopilotRelayModelProvider } from "./CopilotRelayModelProvider.js";
import { CreateModelProvider, GetConfiguredProviders } from "./ModelProviderFactory.js";
import { GetRequiredValue } from "./ModelProviderSettings.js";
import { OllamaModelProvider } from "./OllamaModelProvider.js";
import { Errors } from "../diagnostics/MainErrorManager.js";

// Main-process model boundary shared by conversational feature owners.
export class ModelApi
{
	// Discovers choices from the configured provider without exposing credentials.
	public async ListModelsAsync(signal?: AbortSignal): Promise<readonly AvailableModel[]>
	{
		const providers = GetConfiguredProviders();
		const models: AvailableModel[] = [];
		let firstFailure: unknown = null;

		for (const provider of providers)
		{
			signal?.throwIfAborted();
			try
			{
				const discovered = await this.ListProviderModelsAsync(provider, signal);
				this.AddModels(models, provider, discovered);
			}
			catch (error)
			{
				firstFailure = firstFailure ?? error;
				const message = error instanceof Error ? error.message : "Unknown provider discovery failure.";
				Errors.Warning("ModelApi", "An enabled model provider could not be discovered.", {
					provider,
					message
				});
			}
		}
		if (models.length === 0 && firstFailure !== null) throw firstFailure;
		return models;
	}

	// Resolves untrusted selections against current availability without silent fallback.
	public async ResolveSelectionAsync(value: unknown, signal?: AbortSignal): Promise<ModelSelection>
	{
		if (value === null || typeof value !== "object")
		{
			throw ApplicationError.Expected("validation", "INVALID_MODEL_SELECTION", "Choose an available model.");
		}
		const candidate = value as Record<string, unknown>;
		if (typeof candidate.provider !== "string" || typeof candidate.model !== "string" || candidate.model.length === 0 || candidate.model.length > 128)
		{
			throw ApplicationError.Expected("validation", "INVALID_MODEL_SELECTION", "Choose an available model.");
		}
		const provider = candidate.provider as ProviderId;
		const enabled = GetConfiguredProviders().includes(provider);
		if (!enabled)
		{
			throw ApplicationError.Expected("not-found", "MODEL_UNAVAILABLE", "The selected model is unavailable. Choose another model to continue.");
		}
		signal?.throwIfAborted();
		const discovered = await this.ListProviderModelsAsync(provider, signal);
		let selection: ModelSelection | null = null;
		for (const model of discovered)
		{
			if (model === candidate.model)
			{
				selection = { provider, model };
			}
		}
		if (selection === null)
		{
			throw ApplicationError.Expected("not-found", "MODEL_UNAVAILABLE", "The selected model is unavailable. Choose another model to continue.");
		}
		return selection;
	}

	// Executes only main-assembled requests using a selection validated by the caller.
	public async CompleteAsync(selection: ModelSelection, request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		signal?.throwIfAborted();
		const provider = CreateModelProvider(selection);
		const response = await provider.CompleteAsync(request, onDelta, signal);
		return response;
	}

	// Discovers provider-owned model identities without exposing configuration.
	private async ListProviderModelsAsync(provider: ProviderId, signal?: AbortSignal): Promise<readonly string[]>
	{
		let models: readonly string[];

		if (provider === "copilot-relay")
		{
			const relay = new CopilotRelayModelProvider();
			models = await relay.ListModelFamiliesAsync();
		}
		else if (provider === "kimi")
		{
			const model = GetRequiredValue(["KIMI_MODEL", "MODEL_NAME"], "KIMI_MODEL");
			models = [model];
		}
		else if (provider === "ollama")
		{
			const ollama = new OllamaModelProvider();
			models = await ollama.ListModelsAsync(signal);
		}
		else
		{
			models = ["deterministic-mock"];
		}

		return models;
	}

	// Adds validated unique model choices while retaining stable provider identities.
	private AddModels(models: AvailableModel[], provider: ProviderId, discovered: readonly string[]): void
	{
		for (const model of new Set(discovered))
		{
			if (typeof model !== "string" || model.trim().length === 0 || model.length > 128)
			{
				throw ApplicationError.Expected("validation", "INVALID_MODEL_CATALOGUE", "The provider returned an invalid model catalogue.");
			}
			const exists = models.some(function Matches(candidate): boolean
			{
				return candidate.provider === provider && candidate.model === model;
			});
			if (!exists)
			{
				const label = provider === "mock" ? "Mock (local development)" : provider === "ollama" ? `${model} · Ollama` : model;
				models.push({ provider, model, label });
			}
		}
	}
}
