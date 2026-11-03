import { ReadOperationAsync } from "../../../shared/diagnostics/OperationResult.js";
import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type {
	WordEvidenceResult,
	WordObservation,
	WordObservationKey,
	WordPersonResearch,
	WordSearchResult
} from "../../../shared/library/WordExplorationTypes.js";

export class WordExplorationGateway
{
	public async SearchAsync(workId: string, form: string): Promise<WordSearchResult>
	{
		const operation = window.chora.SearchWord(workId, form);
		const result = await ReadOperationAsync(operation);
		return result;
	}

	public async GetEvidenceAsync(selection: TextSelection): Promise<WordEvidenceResult>
	{
		const operation = window.chora.GetWordEvidence(selection);
		const result = await ReadOperationAsync(operation);
		return result;
	}

	public async GetPersonResearchAsync(
		selection: TextSelection,
		lemma: string): Promise<WordPersonResearch>
	{
		const operation = window.chora.GetPersonResearch(selection, lemma);
		return ReadOperationAsync(operation);
	}

	public async OpenExternalSourceAsync(url: string): Promise<void>
	{
		const operation = window.chora.OpenExternalSource(url);
		await ReadOperationAsync(operation);
	}

	public async GetObservationAsync(key: WordObservationKey): Promise<WordObservation>
	{
		const operation = window.chora.GetWordObservation(key);
		return ReadOperationAsync(operation);
	}

	public async SaveObservationAsync(observation: WordObservation): Promise<WordObservation>
	{
		const operation = window.chora.SaveWordObservation(observation);
		return ReadOperationAsync(operation);
	}
}
