import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatContextSnapshot, SendChatMessageCommand } from "../../src/shared/chat/ChatTypes.js";
import type { ModelSelection } from "../../src/shared/models/ModelSelection.js";
import type { ModelResponse } from "../../src/shared/models/ModelTypes.js";
import type { ChatContextSource } from "../../src/main/chat/ChatContextSource.js";
import { ChatRepository } from "../../src/main/chat/ChatRepository.js";
import { ChatService } from "../../src/main/chat/ChatService.js";
import { ModelApi } from "../../src/main/models/ModelApi.js";
import { PromptLoader } from "../../src/main/prompts/PromptLoader.js";

const roots: string[] = [];
const selection: ModelSelection = { provider: "ollama", model: "qwen3.5:9b" };
const command: SendChatMessageCommand = {
	conversationId: "dream-1",
	clientRequestId: "request-1",
	model: selection,
	content: "What should I notice?",
	selection: null
};

function CreateContext(id: string): ChatContextSnapshot
{
	return {
		id,
		scope: { kind: "dream", id: command.conversationId },
		revision: "2026-10-29T00:00:00.000Z",
		content: `Dream context ${id}`,
		capturedAt: "2026-10-29T00:00:01.000Z"
	};
}

function CreateResponse(): ModelResponse
{
	return {
		provider: "ollama",
		model: selection.model,
		rawText: "A completed response."
	};
}

async function CreateServiceAsync(source: ChatContextSource): Promise<{ service: ChatService; repository: ChatRepository; models: ModelApi }>
{
	const root = await mkdtemp(path.join(os.tmpdir(), "chora-chat-"));
	roots.push(root);
	const repository = new ChatRepository(root);
	const models = new ModelApi();
	vi.spyOn(models, "ResolveSelectionAsync").mockResolvedValue(selection);
	const prompts = new PromptLoader(path.join(process.cwd(), "Prompts"));
	const service = new ChatService(repository, source, "dream-discussion", models, prompts);
	return { service, repository, models };
}

afterEach(async function RemoveTemporaryRootsAsync(): Promise<void>
{
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("ChatService", function ChatServiceTests()
{
	it("releases captured feature state before model work and validates the selection once", async function ReleasesSnapshotBeforeInferenceAsync(): Promise<void>
	{
		let capturing = false;
		const source: ChatContextSource = {
			CaptureAsync: async function CaptureAsync(): Promise<ChatContextSnapshot>
			{
				capturing = true;
				const context = CreateContext("context-1");
				capturing = false;
				return context;
			}
		};
		const context = await CreateServiceAsync(source);
		const completion = vi.spyOn(context.models, "CompleteAsync").mockImplementation(async function CompleteAsync(): Promise<ModelResponse>
		{
			expect(capturing).toBe(false);
			return CreateResponse();
		});
		const resolution = vi.spyOn(context.models, "ResolveSelectionAsync");

		const snapshot = await context.service.SendAsync(command);

		expect(resolution).toHaveBeenCalledTimes(1);
		expect(completion).toHaveBeenCalledTimes(1);
		expect(snapshot.contexts).toHaveLength(1);
		expect(snapshot.messages.at(-1)?.status).toBe("completed");
	});

	it("removes the replaced turn context when retrying a failed request", async function RemovesRetryContextAsync(): Promise<void>
	{
		let capture = 0;
		const source: ChatContextSource = {
			CaptureAsync: async function CaptureAsync(): Promise<ChatContextSnapshot>
			{
				capture += 1;
				return CreateContext(`context-${capture}`);
			}
		};
		const context = await CreateServiceAsync(source);
		vi.spyOn(context.models, "CompleteAsync")
			.mockRejectedValueOnce(new Error("Remote Ollama failed."))
			.mockResolvedValueOnce(CreateResponse());

		await expect(context.service.SendAsync(command)).rejects.toThrow("Remote Ollama failed.");
		const retried = await context.service.SendAsync(command);

		expect(retried.contexts.map(function SelectId(value): string { return value.id; })).toEqual(["context-2"]);
		expect(retried.messages).toHaveLength(2);
		expect(retried.messages.every(function UsesLatestContext(message): boolean { return message.contextId === "context-2"; })).toBe(true);
	});
});
