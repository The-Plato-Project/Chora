import { randomUUID } from "node:crypto";
import type { UpdateVisionCommand, VisionSnapshot } from "../../shared/visions/VisionTypes.js";

const MaximumTitleLength = 200;
const MaximumMarkdownLength = 5 * 1024 * 1024;

export class Vision
{
	public static Create(workId: string, folderPath: string, now = new Date()): VisionSnapshot
	{
		Vision.AssertWorkId(workId);
		Vision.AssertFolderPath(folderPath);
		const timestamp = now.toISOString();

		return {
			id: randomUUID(),
			workId,
			folderPath,
			title: "Untitled Vision",
			markdown: "",
			createdAt: timestamp,
			updatedAt: timestamp
		};
	}

	public static Update(existing: VisionSnapshot, command: UpdateVisionCommand, now = new Date()): VisionSnapshot
	{
		if (command.id !== existing.id) throw new Error("The Vision update does not match the stored Vision.");
		const title = command.title.trim();
		Vision.AssertTitle(title);
		Vision.AssertMarkdown(command.markdown);

		return {
			...existing,
			title,
			markdown: command.markdown,
			updatedAt: now.toISOString()
		};
	}

	public static AssertSnapshot(candidate: VisionSnapshot): void
	{
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate.id))
			throw new Error("The Vision has an invalid identity.");
		Vision.AssertWorkId(candidate.workId);
		Vision.AssertFolderPath(candidate.folderPath);
		Vision.AssertTitle(candidate.title);
		Vision.AssertMarkdown(candidate.markdown);
		if (!Vision.IsTimestamp(candidate.createdAt) || !Vision.IsTimestamp(candidate.updatedAt))
			throw new Error("The Vision has invalid timestamps.");
	}

	private static AssertWorkId(workId: string): void
	{
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(workId)) throw new Error("The Vision has an invalid work identity.");
	}

	private static AssertTitle(title: string): void
	{
		if (title.length === 0 || title.length > MaximumTitleLength || title !== title.trim())
			throw new Error("A Vision title must contain between 1 and 200 characters.");
	}

	private static AssertFolderPath(folderPath: string): void
	{
		const segments = folderPath.length === 0 ? [] : folderPath.split("/");
		const valid = !folderPath.startsWith("/")
			&& !folderPath.endsWith("/")
			&& !folderPath.includes("\\")
			&& segments.every((segment) => segment.length > 0
				&& segment !== "."
				&& segment !== ".."
				&& segment.length <= 120
				&& !/[<>:"/\\|?*\u0000-\u001f]/u.test(segment));
		if (!valid) throw new Error("The Vision has an invalid folder path.");
	}

	private static AssertMarkdown(markdown: string): void
	{
		if (markdown.length > MaximumMarkdownLength) throw new Error("The Vision is too large to save.");
	}

	private static IsTimestamp(value: string): boolean
	{
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}
}
