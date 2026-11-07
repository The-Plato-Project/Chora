import { CloseIcon } from "./Icons.js";

export class FloatingPanel
{
	private static nextOffset = 0;
	private static nextZIndex = 30;
	private readonly root: HTMLElement;
	private readonly body: HTMLElement;
	private readonly heading: HTMLHeadingElement;
	private drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
	private positioned = false;
	private readonly pointerDownHandler = this.HandlePointerDown.bind(this);
	private readonly pointerMoveHandler = this.HandlePointerMove.bind(this);
	private readonly pointerUpHandler = this.HandlePointerUp.bind(this);

	public constructor(key: string, title: string)
	{
		this.root = document.createElement("section");
		this.root.className = "floating-panel";
		this.root.dataset.floatingPanel = key;
		this.root.hidden = true;
		this.root.setAttribute("role", "dialog");
		this.root.setAttribute("aria-modal", "false");

		const header = document.createElement("header");
		header.className = "floating-panel-header";
		this.heading = document.createElement("h3");
		this.heading.textContent = title;
		const close = document.createElement("button");
		close.type = "button";
		close.className = "floating-panel-close button-control";
		close.setAttribute("aria-label", `Close ${title}`);
		close.innerHTML = CloseIcon;
		close.addEventListener("click", this.Close.bind(this));
		header.append(this.heading, close);

		this.body = document.createElement("div");
		this.body.className = "floating-panel-body word-exploration";
		this.root.append(header, this.body);
		document.body.appendChild(this.root);

		this.root.addEventListener("pointerdown", this.BringToFront.bind(this));
		header.addEventListener("pointerdown", this.pointerDownHandler);
		window.addEventListener("pointermove", this.pointerMoveHandler);
		window.addEventListener("pointerup", this.pointerUpHandler);
		window.addEventListener("pointercancel", this.pointerUpHandler);
	}

	public get IsOpen(): boolean
	{
		return !this.root.hidden;
	}

	public Open(): void
	{
		if (!this.positioned)
		{
			const offset = FloatingPanel.nextOffset % 8;
			FloatingPanel.nextOffset += 1;
			this.root.style.left = `${Math.max(16, window.innerWidth - 660 - offset * 24)}px`;
			this.root.style.top = `${56 + offset * 24}px`;
			this.positioned = true;
		}
		this.root.hidden = false;
		this.BringToFront();
	}

	public Close(): void
	{
		this.root.hidden = true;
		this.drag = null;
	}

	public SetTitle(title: string): void
	{
		this.heading.textContent = title;
	}

	public SetBody(content: HTMLElement): void
	{
		this.body.replaceChildren(content);
	}

	public OnBodyClick(handler: (event: MouseEvent) => void): void
	{
		this.body.addEventListener("click", handler);
	}

	public OnBodyInput(handler: (event: Event) => void): void
	{
		this.body.addEventListener("input", handler);
	}

	public Dispose(): void
	{
		window.removeEventListener("pointermove", this.pointerMoveHandler);
		window.removeEventListener("pointerup", this.pointerUpHandler);
		window.removeEventListener("pointercancel", this.pointerUpHandler);
		this.root.remove();
	}

	private BringToFront(): void
	{
		FloatingPanel.nextZIndex += 1;
		this.root.style.zIndex = String(FloatingPanel.nextZIndex);
	}

	private HandlePointerDown(event: PointerEvent): void
	{
		const target = event.target as HTMLElement | null;
		if (target?.closest("button")) return;
		const bounds = this.root.getBoundingClientRect();
		this.drag = {
			pointerId: event.pointerId,
			offsetX: event.clientX - bounds.left,
			offsetY: event.clientY - bounds.top
		};
		event.preventDefault();
		this.BringToFront();
	}

	private HandlePointerMove(event: PointerEvent): void
	{
		if (this.drag === null || this.drag.pointerId !== event.pointerId) return;
		const maximumX = Math.max(0, window.innerWidth - 180);
		const maximumY = Math.max(0, window.innerHeight - 80);
		this.root.style.left = `${Math.max(0, Math.min(event.clientX - this.drag.offsetX, maximumX))}px`;
		this.root.style.top = `${Math.max(0, Math.min(event.clientY - this.drag.offsetY, maximumY))}px`;
	}

	private HandlePointerUp(event: PointerEvent): void
	{
		if (this.drag?.pointerId === event.pointerId) this.drag = null;
	}
}
