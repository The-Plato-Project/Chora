import matter from "gray-matter";
import type { VisionSnapshot } from "../../shared/visions/VisionTypes.js";
import { Vision } from "./Vision.js";

interface VisionFrontmatter
{
	readonly format: "chora.vision.v1";
	readonly id: string;
	readonly workId: string;
	readonly title: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export class VisionMarkdownCodec
{
	public Encode(vision: VisionSnapshot): string
	{
		Vision.AssertSnapshot(vision);
		const frontmatter: VisionFrontmatter = {
			format: "chora.vision.v1",
			id: vision.id,
			workId: vision.workId,
			title: vision.title,
			createdAt: vision.createdAt,
			updatedAt: vision.updatedAt
		};

		return matter.stringify(vision.markdown, frontmatter);
	}

	public Decode(source: string, folderPath = ""): VisionSnapshot
	{
		const document = matter(source);
		const data = document.data as Partial<VisionFrontmatter>;
		if (data.format !== "chora.vision.v1") throw new Error("The file is not a supported Vision document.");
		const vision: VisionSnapshot = {
			id: String(data.id ?? ""),
			workId: String(data.workId ?? ""),
			folderPath,
			title: String(data.title ?? ""),
			markdown: document.content,
			createdAt: String(data.createdAt ?? ""),
			updatedAt: String(data.updatedAt ?? "")
		};
		Vision.AssertSnapshot(vision);

		return vision;
	}
}
