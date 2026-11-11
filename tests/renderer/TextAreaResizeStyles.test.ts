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

	it("uses shared handles and Vision editor behavior", function ProvidesResizeHandles(): void
	{
		const basePath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const markdownPath = resolve(process.cwd(), "src", "renderer", "styles", "markdown-editor.css");
		const visionPath = resolve(process.cwd(), "src", "renderer", "styles", "vision-editor.css");
		const base = readFileSync(basePath, "utf8");
		const markdown = readFileSync(markdownPath, "utf8");
		const vision = readFileSync(visionPath, "utf8");
		const splits = readFileSync("src/renderer/styles/split-view.css", "utf8");

		expect(base).toMatch(/textarea\.multiline-input\s*\{[^}]*resize:\s*none;/s);
		expect(splits).toMatch(/\.split-divider\[aria-orientation="horizontal"\]\s*\{[^}]*cursor:\s*row-resize;/s);
		expect(markdown).toMatch(/textarea::\-webkit-resizer,[^{]*\.markdown-content::\-webkit-resizer/s);
		expect(base).toMatch(/\.multiline-input:focus,[^{]*:focus-within\s*\{[^}]*border-color:\s*var\(--panel-border\);[^}]*outline:\s*0;/s);
		expect(vision).not.toContain(".markdown-editor.multiline-input:focus");
	});

});
