import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import fs from "node:fs/promises";
import type { LibraryManifest, LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import { TextDocument, type TextDocumentSnapshot } from "../../shared/text/TextDocument.js";
import { ResolveCorpusPath } from "../bootstrap/ResourcePaths.js";

export class LibraryRepository
{
	private static readonly ManifestFile = "manifest.json";
	private static readonly TextsDirectory = "works";

	public async ListAsync(): Promise<LibraryTextSummary[]>
	{
		const manifest = await this.LoadManifestAsync();
		return manifest.works;
	}

	public async GetAsync(textId: string): Promise<TextDocument>
	{
		const manifest = await this.LoadManifestAsync();
		let isKnownText = false;

		for (const text of manifest.works)
		{
			if (text.id === textId)
			{
				isKnownText = true;
			}
		}

		if (!isKnownText)
		{
			throw ApplicationError.Expected("not-found", "TEXT_NOT_FOUND", `No Library text matches ${textId}`);
		}

		const textPath = ResolveCorpusPath(LibraryRepository.TextsDirectory, `${textId}.json`);
		const content = await fs.readFile(textPath, "utf8");
		const snapshot = JSON.parse(content) as TextDocumentSnapshot;
		const text = TextDocument.FromSnapshot(snapshot);
		return text;
	}

	private async LoadManifestAsync(): Promise<LibraryManifest>
	{
		const manifestPath = ResolveCorpusPath(LibraryRepository.ManifestFile);
		const content = await fs.readFile(manifestPath, "utf8");
		const manifest = JSON.parse(content) as LibraryManifest;
		return manifest;
	}
}
