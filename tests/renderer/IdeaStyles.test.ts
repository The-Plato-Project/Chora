import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Idea styles", function IdeaStyleTests()
{
	it("keeps the Idea editor bounded to its viewport", function KeepsIdeaEditorBounded()
	{
		const stylesheetPath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const dreamStylesheetPath = resolve(process.cwd(), "src", "renderer", "styles", "dream-editor.css");
		const css = readFileSync(stylesheetPath, "utf8");
		const dreamCss = readFileSync(dreamStylesheetPath, "utf8");

		expect(css).toMatch(/\.idea-panel\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
		expect(css).toMatch(/\.document-editor\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
		expect(css).toMatch(/\.document-signals-section\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/s);
		expect(css).toMatch(/\.signal-view-body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
		expect(css).toMatch(/\.signal-view-body > \.signal-list\s*\{[^}]*overflow:\s*auto;/s);
		expect(css).not.toMatch(/\.document-interpretation textarea/);
		expect(css).toMatch(/\.idea-tabs-host > \.tab-control\s*\{[^}]*grid-template-rows:\s*40px minmax\(0, 1fr\);[^}]*min-height:\s*0;/s);
		expect(css).toMatch(/\.idea-seeing-markdown\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--panel-border\);/s);
		expect(css).toMatch(/\.document-editor-actions\s*\{[^}]*display:\s*flex;[^}]*flex:\s*0 0 auto;[^}]*justify-content:\s*flex-end;[^}]*min-height:\s*58px;[^}]*border:\s*1px solid var\(--panel-border\);/s);
		expect(css).toMatch(/\.progress-bar\s*\{[^}]*width:\s*100%;[^}]*height:\s*3px;[^}]*overflow:\s*hidden;/s);
		expect(css).toMatch(/\.idea-signal-search-controls \.application-find\s*\{[^}]*width:\s*100%;[^}]*height:\s*38px;/s);
		expect(css).toMatch(/\.signal-view-add\s*\{[^}]*align-self:\s*flex-start;[^}]*width:\s*auto;[^}]*min-height:\s*24px;[^}]*margin:\s*0 4px 0 0;[^}]*padding:\s*2px 8px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
		expect(css).toMatch(/\.signal-view-empty-icon\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*margin-inline:\s*auto;/s);
		expect(css).toMatch(/\.signal-view-empty-state\s*\{[^}]*flex:\s*1 1 auto;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*width:\s*100%;/s);
		expect(dreamCss).toMatch(/\.dream-editor\.document-editor\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto 7px minmax\(0, 1fr\) auto;/s);
		expect(dreamCss).toMatch(/\.dream-tabs-host \.signal-view-panel\.signal-view-panel-without-header\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/s);
		expect(dreamCss).toMatch(/\.signal-header \.signal-row\s*\{[^}]*min-height:\s*24px;[^}]*padding:\s*1px 8px;/s);
		expect(dreamCss).toMatch(/\.signal-heading\s*\{[^}]*font-size:\s*12px;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
		expect(dreamCss).toMatch(/\.dream-editor \.signal-markdown-editor \.markdown-content,[^{]*\{[^}]*resize:\s*none;/s);
		expect(dreamCss).toMatch(/\.signal-title-field input\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid transparent;[^}]*background:\s*transparent;[^}]*font:\s*600 14px/s);
		expect(dreamCss).toMatch(/\.signal-title-field input:focus\s*\{[^}]*border-bottom-color:\s*var\(--signal-editor-secondary-text\);/s);
		expect(dreamCss).toMatch(/\.signal-detail-body\s*\{[^}]*--signal-editor-inset:\s*16px;[^}]*--signal-editor-row-height:\s*24px;/s);
		expect(dreamCss).toMatch(/\.signal-passage\s*\{[^}]*grid-template-columns:\s*14px minmax\(0, 1fr\) 22px;[^}]*min-height:\s*var\(--signal-editor-row-height\);[^}]*background:\s*var\(--signal-editor-passage-background\);/s);
		expect(dreamCss).toMatch(/\.signal-passage-remove\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*opacity:\s*1;/s);
		expect(dreamCss).toMatch(/\.signal-observation \.signal-markdown-editor \.markdown-content\s*\{[^}]*padding:\s*16px var\(--signal-editor-inset\);[^}]*background:\s*transparent;/s);
		expect(dreamCss).toMatch(/:is\(\.dream-editor, \.idea-editor\) \[hidden\]\s*\{[^}]*display:\s*none;/s);
		expect(dreamCss).toMatch(/\.dream-editor \.dream-reflections-markdown,[^{]*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--panel-border\);/s);
	});
});
