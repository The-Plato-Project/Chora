import { CreateDreamSnapshot } from "./DreamView.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { DreamMarkdownExport } from "../../shared/dreams/DreamMarkdownExport.js";
import { DreamStore } from "./DreamStore.js";
import { LibraryGateway } from "../library/LibraryGateway.js";


// Owns exporting the active Dream through the existing Markdown formatter and clipboard gateway.
export class DreamExportController
{

	// Resolves export inputs through the existing renderer state owners.
	public constructor(private readonly store: DreamStore, private readonly library: LibraryStore, private readonly reader: LibraryGateway)
	{
	}

	// Resolves the active Dream and copies its complete Markdown projection.
	public async CopyDreamAsMarkdownAsync(): Promise<void>
	{
		const dream = this.store.GetActiveDream();

		if (dream === null)
		{
			throw new Error("The active Dream is no longer available.");
		}
		else
		{
			const document = this.library.GetText();

			if (document === null || document.id !== dream.workId)
			{
				throw new Error("The Dream source document is not open.");
			}

			const snapshot = CreateDreamSnapshot(dream);
			const markdown = DreamMarkdownExport.Serialize(snapshot, document);
			await this.reader.CopyAsync(markdown);
		}
	}

}
