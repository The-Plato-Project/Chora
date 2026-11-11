// Reusable application status surface with empty start/end content slots.
export class StatusBarControl
{
	// Stable footer mounted outside all resizable panel groups.
	public readonly Root = document.createElement("footer");
	// Content owners may attach status items without depending on workspace layout.
	public readonly Start = document.createElement("div");
	// Trailing status items align independently from the start slot.
	public readonly End = document.createElement("div");

	// Creates an empty status bar; the layout owner chooses where to attach it.
	public constructor()
	{
		this.Root.className = "status-bar-control";
		this.Root.setAttribute("role", "status");
		this.Root.setAttribute("aria-label", "Application status");
		this.Start.className = "status-bar-start";
		this.End.className = "status-bar-end";
		this.Root.append(this.Start, this.End);
	}

	// Releases this control's DOM independently from any surrounding panels.
	public Dispose(): void
	{
		this.Root.remove();
	}
}
