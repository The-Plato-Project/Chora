import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { AvailableModel } from "../../shared/models/ModelSelection.js";

// Stateless typed client for the privileged model catalogue.
export class ModelGateway
{
	// Retrieves configured choices through the standard failure envelope.
	public async ListModelsAsync(): Promise<readonly AvailableModel[]>
	{
		const operation = window.chora.ListModels();
		const models = await ReadOperationAsync(operation);
		return models;
	}
}
