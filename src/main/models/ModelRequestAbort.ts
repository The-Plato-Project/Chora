export function LinkModelRequestAbort(controller: AbortController, signal: AbortSignal | undefined): () => void
{
	function Abort(): void
	{
		controller.abort();
	}

	if (signal?.aborted === true) controller.abort();
	else signal?.addEventListener("abort", Abort, { once: true });

	return function Unlink(): void
	{
		signal?.removeEventListener("abort", Abort);
	};
}
