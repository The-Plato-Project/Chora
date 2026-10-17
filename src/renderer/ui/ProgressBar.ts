import { EscapeHtml } from "./Html.js";

export function RenderProgressBar(label: string, hidden = false): string
{
	const hiddenAttribute = hidden ? " hidden" : "";
	return `<div class="progress-bar" role="progressbar" aria-label="${EscapeHtml(label)}"${hiddenAttribute}><span aria-hidden="true"></span></div>`;
}
