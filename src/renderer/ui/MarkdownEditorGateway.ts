import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { FormattingAction } from "../../shared/contracts/ChoraApi.js";

export class MarkdownEditorGateway
{
	public ShowFormattingMenuAsync(): Promise<FormattingAction>
	{
		const action = ReadOperationAsync(window.chora.ShowFormattingContextMenu());
		return action;
	}
}