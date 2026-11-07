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

	it("uses shared handles and multiline editor behavior", function ProvidesResizeHandles(): void
	{
		const basePath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const dreamPath = resolve(process.cwd(), "src", "renderer", "styles", "dream-editor.css");
		const markdownPath = resolve(process.cwd(), "src", "renderer", "styles", "markdown-editor.css");
		const base = readFileSync(basePath, "utf8");
		const dream = readFileSync(dreamPath, "utf8");
		const markdown = readFileSync(markdownPath, "utf8");

		expect(base).toMatch(/textarea\.multiline-input,[^{]*\.dream-field textarea\s*\{[^}]*resize:\s*none;/s);
		expect(base).toMatch(/\.row-resize-handle\s*\{[^}]*cursor:\s*row-resize;/s);
		expect(dream).toMatch(/\.dream-editor \.dream-source-section\s*\{[^}]*overflow:\s*auto;[^}]*resize:\s*none;/s);
		expect(dream).toMatch(/\.dream-editor\.document-editor \.dream-source-section\s*\{[^}]*height:\s*9rem;[^}]*max-height:\s*70vh;/s);
		expect(dream).toMatch(/\.dream-editor \.signal-markdown-editor \.markdown-content\s*\{[^}]*resize:\s*none;/s);
		expect(markdown).toMatch(/textarea::\-webkit-resizer,[^{]*\.markdown-content::\-webkit-resizer/s);
	});

});
