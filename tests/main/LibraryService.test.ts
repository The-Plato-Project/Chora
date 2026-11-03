import { describe, expect, it, vi } from "vitest";
import { LibraryService, type LibraryReader } from "../../src/main/library/LibraryService.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

function CreateDocument(): TextDocument
{
	return TextDocument.FromSnapshot({
		id: "republic",
		textVersion: `sha256:${"0".repeat(64)}`,
		urn: null,
		title: "Republic",
		titleGreek: null,
		author: "Plato",
		language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "test", commit: "test", sourceFile: "republic.xml", license: "test" },
		segments: [{ key: "327a", citation: { system: "stephanus", value: "327a" }, text: "κατέβην" }]
	});
}

describe("LibraryService", function LibraryServiceTests()
{
	it("shares one immutable work request across text and source-notice consumers", async function SharesDocumentAsync(): Promise<void>
	{
		const document = CreateDocument();
		const get = vi.fn(async function GetAsync(): Promise<TextDocument>
		{
			return document;
		});
		const reader: LibraryReader = {
			ListAsync: async function ListAsync() { return []; },
			GetAsync: get
		};
		const service = new LibraryService(reader);

		const [loaded, notice] = await Promise.all([
			service.GetAsync("republic"),
			service.GetSourceNoticeAsync("republic")
		]);

		expect(loaded).toBe(document);
		expect(notice.repository).toBe("test");
		expect(get).toHaveBeenCalledOnce();
	});
});
