import { describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelRequest } from "../../src/shared/models/ModelTypes.js";
import { DreamSynopticViewService } from "../../src/main/dreams/DreamSynopticViewService.js";
import type { PromptLoader } from "../../src/main/prompts/PromptLoader.js";

function CreatePromptLoader(): PromptLoader
{
	return { LoadAsync: vi.fn().mockResolvedValue("Clarity Check system prompt") } as unknown as PromptLoader;
}

describe("DreamSynopticViewService", function DreamSynopticViewServiceTests()
{
	it("sends one fresh reading document without chat context or history", async function BuildsFreshRequestAsync()
	{
		const complete = vi.fn(async () => ({ provider: "mock" as const, model: "mock", rawText: "  ## Clarity Check\n\nA relationship.  " }));
		const provider = { id: "mock" as const, CompleteAsync: complete } satisfies ModelProvider;
		const prompts = CreatePromptLoader();
		const service = new DreamSynopticViewService(prompts, () => provider);

		const result = await service.CreateAsync({ dreamId: "dream-1", readingDocument: "# Dream\n\n## Reflections\n\nA descent." });

		expect(result).toBe("## Clarity Check\n\nA relationship.");
		const request = complete.mock.calls[0]?.[0] as ModelRequest;
		expect(request.systemPrompt).toBe("Clarity Check system prompt");
		expect(request.history).toEqual([]);
		expect(request.context).toBeUndefined();
		expect(request.userPrompt).toContain("<reading_document>\n# Dream");
		expect(request.userPrompt).toContain("</reading_document>");
		expect(prompts.LoadAsync).toHaveBeenCalledWith("clarity-check");
	});

	it("prevents duplicate requests and cancels the active provider call", async function CancelsRequestAsync()
	{
		const complete = vi.fn(function Complete(_request: ModelRequest, _onDelta?: unknown, signal?: AbortSignal): Promise<never>
		{
			return new Promise(function Wait(_resolve, reject): void
			{
				signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
			});
		});
		const provider = { id: "mock" as const, CompleteAsync: complete } satisfies ModelProvider;
		const service = new DreamSynopticViewService(CreatePromptLoader(), () => provider);
		const request = { dreamId: "dream-1", readingDocument: "# Dream" };
		const active = service.CreateAsync(request);

		await expect(service.CreateAsync(request)).rejects.toThrow("already being generated");
		service.Cancel("dream-1");
		await expect(active).rejects.toMatchObject({ name: "AbortError" });
	});

	it("rejects an empty model response", async function RejectsEmptyResponseAsync()
	{
		const provider = { id: "mock" as const, CompleteAsync: vi.fn(async () => ({ provider: "mock" as const, model: "mock", rawText: "  " })) } satisfies ModelProvider;
		const service = new DreamSynopticViewService(CreatePromptLoader(), () => provider);

		await expect(service.CreateAsync({ dreamId: "dream-1", readingDocument: "# Dream" })).rejects.toThrow("empty Clarity Check");
	});
});
