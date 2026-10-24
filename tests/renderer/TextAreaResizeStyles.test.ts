import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Text area resize styles", function TextAreaResizeStyleTests()
{
	it("shows the pointer cursor for enabled buttons", function ShowsButtonCursor(): void
	{
		const basePath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const base = readFileSync(basePath, "utf8");

		expect(base).toMatch(/button:not\(:disabled\)\s*\{[^}]*cursor:\s*pointer;/s);
		expect(base).toMatch(/button:disabled\s*\{[^}]*cursor:\s*default;/s);
	});

	it("provides resize controls for text editors and source text", function ProvidesResizeHandles(): void
	{
		const basePath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const dreamPath = resolve(process.cwd(), "src", "renderer", "styles", "dream-editor.css");
		const markdownPath = resolve(process.cwd(), "src", "renderer", "styles", "markdown-editor.css");
		const base = readFileSync(basePath, "utf8");
		const dream = readFileSync(dreamPath, "utf8");
		const markdown = readFileSync(markdownPath, "utf8");

		expect(base).toMatch(/\.dream-field textarea\s*\{[^}]*resize:\s*vertical;[^}]*overflow:\s*auto;/s);
		expect(dream).toMatch(/\.dream-editor \.dream-source-section\s*\{[^}]*overflow:\s*auto;[^}]*resize:\s*none;/s);
		expect(dream).toMatch(/\.dream-editor\.document-editor \.dream-source-section\s*\{[^}]*height:\s*9rem;[^}]*max-height:\s*70vh;/s);
		expect(dream).toMatch(/\.dream-source-divider\s*\{[^}]*cursor:\s*row-resize;/s);
		expect(dream).toMatch(/\.dream-editor \.signal-markdown-editor \.markdown-content,[^{]*\{[^}]*resize:\s*none;/s);
		expect(markdown).toMatch(/textarea::\-webkit-resizer,[^{]*\.markdown-content::\-webkit-resizer/s);
	});

	it("keeps the Signal Idea menu inside the viewport without wrapping titles", function KeepsIdeaMenuVisible(): void
	{
		const dreamPath = resolve(process.cwd(), "src", "renderer", "styles", "dream-editor.css");
		const dream = readFileSync(dreamPath, "utf8");

		expect(dream).toMatch(/\.signal-editor-actions \.signal-ideas-menu \.action-menu-items\s*\{[^}]*position:\s*fixed;[^}]*max-width:\s*calc\(100vw - 24px\);[^}]*overflow-y:\s*auto;/s);
		expect(dream).toMatch(/\.signal-editor-actions \.signal-ideas-menu \.action-menu-items button\s*\{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\);/s);
		expect(dream).toMatch(/\.signal-editor-actions \.signal-ideas-menu \.action-menu-items button span\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
	});
});
