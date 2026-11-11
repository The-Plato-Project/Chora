import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkStoragePaths } from "../../src/main/storage/WorkStoragePaths.js";
import { VisionMarkdownCodec } from "../../src/main/visions/VisionMarkdownCodec.js";
import { VisionRepository } from "../../src/main/visions/VisionRepository.js";
import type { VisionSnapshot } from "../../src/shared/visions/VisionTypes.js";

vi.mock("node:fs/promises", async function MockFileAccess(importOriginal)
{
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const roots: string[] = [];

function CreateVision(markdown = "# Inquiry\n\n- [ ] Return to **327a**\n\n| Word | Note |\n| --- | --- |\n| λόγος | relation |\n"): VisionSnapshot
{
	return {
		id: "123e4567-e89b-42d3-a456-426614174000",
		workId: "republic",
		folderPath: "",
		title: "The shape of the descent",
		markdown,
		createdAt: "2026-09-10T12:00:00.000Z",
		updatedAt: "2026-09-10T12:00:00.000Z"
	};
}

afterEach(async function RemoveTemporaryRootsAsync(): Promise<void>
{
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Vision persistence", function VisionPersistenceTests()
{
	it("round trips GFM Markdown without deriving identity from the first heading", function RoundTripsMarkdown(): void
	{
		const codec = new VisionMarkdownCodec();
		const vision = CreateVision();
		const encoded = codec.Encode(vision);

		expect(codec.Decode(encoded)).toEqual(vision);
		expect(encoded).toContain("format: chora.vision.v1");
		expect(encoded).toContain("title: The shape of the descent");
		expect(encoded).toContain("| λόγος | relation |");
	});

	it("stores Visions in nested work folders and reloads their filesystem location", async function StoresNestedVisionsAsync(): Promise<void>
	{
		const root = await mkdtemp(path.join(os.tmpdir(), "chora-vision-"));
		roots.push(root);
		const paths = new WorkStoragePaths(root, [{ id: "republic", title: "Republic" }]);
		const repository = new VisionRepository(paths);
		const vision = { ...CreateVision(), folderPath: "Book 1/Questions" };
		if (process.platform === "win32")
		{
			vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("temporarily locked"), { code: "EPERM" }));
			vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("temporarily busy"), { code: "EBUSY" }));
		}

		await repository.SaveAsync(vision);
		expect(rename).toHaveBeenCalledTimes(process.platform === "win32" ? 3 : 1);

		const file = path.join(root, "The Republic", "Visions", "Book 1", "Questions", `${vision.id}.md`);
		expect(await readFile(file, "utf8")).toContain("# Inquiry");
		expect(paths.Resolve("republic", "Visions")).toBe(path.join(root, "The Republic", "Visions"));
		expect(await repository.LoadCatalogueAsync()).toEqual({
			visions: [vision],
			folders: [
				{ workId: "republic", path: "Book 1", name: "Book 1", parentPath: "" },
				{ workId: "republic", path: "Book 1/Questions", name: "Questions", parentPath: "Book 1" }
			]
		});

		const original = await readFile(file, "utf8");
		const denied = Object.assign(new Error("replacement denied"), { code: "EPERM" });
		const attempts = process.platform === "win32" ? 4 : 1;
		vi.mocked(rename).mockClear();
		for (let index = 0; index < attempts; index += 1) vi.mocked(rename).mockRejectedValueOnce(denied);
		// Cleanup failure must not replace the original error or touch the saved destination.
		vi.mocked(rm).mockRejectedValueOnce(new Error("temporary cleanup denied"));
		await expect(repository.SaveAsync({ ...vision, markdown: "Unsaved changes" })).rejects.toBe(denied);
		expect(rename).toHaveBeenCalledTimes(attempts);
		expect(await readFile(file, "utf8")).toBe(original);

		const full = Object.assign(new Error("disk full"), { code: "ENOSPC" });
		vi.mocked(rename).mockClear();
		vi.mocked(rename).mockRejectedValueOnce(full);
		await expect(repository.SaveAsync({ ...vision, markdown: "Still unsaved" })).rejects.toBe(full);
		expect(rename).toHaveBeenCalledTimes(1);
		expect(await readFile(file, "utf8")).toBe(original);

		await repository.DeleteAsync(vision);
		expect((await repository.LoadCatalogueAsync()).visions).toEqual([]);
	});
});
