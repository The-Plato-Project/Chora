import type { CreateTextAnchorCommand, TextAnchorSnapshot } from "../../shared/anchors/TextAnchorTypes.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { LibraryService } from "../library/LibraryService.js";
import { TextAnchor } from "./TextAnchor.js";
import type { TextAnchorRepository } from "./TextAnchorRepository.js";

export class TextAnchorService
{
	private readonly anchors = new Map<string, TextAnchorSnapshot>();
	private loadPromise: Promise<void> | null = null;
	private mutation = Promise.resolve();

	public constructor(
		private readonly repository: TextAnchorRepository,
		private readonly documents: LibraryService)
	{
	}

	public async ListAsync(workId: string): Promise<readonly TextAnchorSnapshot[]>
	{
		await this.documents.GetAsync(workId);
		await this.EnsureLoadedAsync();
		return [...this.anchors.values()]
			.filter((anchor) => anchor.workId === workId)
			.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
	}

	public CreateAsync(command: CreateTextAnchorCommand): Promise<TextAnchorSnapshot>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			const document = await this.documents.GetAsync(command.selection.dialogue);
			const created = TextAnchor.Create(document, command.kind, command.selection);
			const existing = this.anchors.get(created.id);
			if (existing !== undefined)
			{
				TextAnchor.Validate(document, existing);
				return existing;
			}
			await this.repository.SaveAsync(created);
			this.anchors.set(created.id, created);
			return created;
		});
	}

	public async ValidateAsync(anchorId: string): Promise<TextAnchorSnapshot>
	{
		await this.EnsureLoadedAsync();
		const anchor = this.anchors.get(anchorId);
		if (anchor === undefined) throw ApplicationError.Expected("not-found", "ANCHOR_NOT_FOUND", "The text reference no longer exists.");
		const document = await this.documents.GetAsync(anchor.workId);
		TextAnchor.Validate(document, anchor);
		return anchor;
	}

	private async EnsureLoadedAsync(): Promise<void>
	{
		if (this.loadPromise === null)
		{
			this.loadPromise = this.repository.LoadAllAsync().then((anchors) =>
			{
				for (const anchor of anchors) this.anchors.set(anchor.id, anchor);
			});
		}
		await this.loadPromise;
	}

	private EnqueueAsync<T>(operation: () => Promise<T>): Promise<T>
	{
		const result = this.mutation.then(operation, operation);
		this.mutation = result.then(() => undefined, () => undefined);
		return result;
	}
}
