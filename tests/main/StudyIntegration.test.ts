import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";
import { StudyEvidence } from "../../src/main/study/StudyEvidence.js";
import { StudyToolServer } from "../../src/main/study/StudyToolServer.js";
import { StudySession } from "../../src/main/study/StudySession.js";
import { StudyConversationRepository } from "../../src/main/study/StudyConversationRepository.js";
import type { StudyBackend } from "../../src/main/study/StudyBackend.js";
import type { StudyScope, StudyUpdate } from "../../src/shared/study/StudyTypes.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Disposable canonical material prevents integration checks from reading personal documents.
function CreateEvidence(scope: StudyScope, writing = { markdown: "An unresolved possibility.", updatedAt: "2026-01-02" }): StudyEvidence
{
	const document = TextDocument.FromSnapshot({ id: "republic", textVersion: `sha256:${"0".repeat(64)}`,
		urn: null, title: "Republic", titleGreek: null, author: "Plato", language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "fixture", commit: "fixture", sourceFile: "fixture", license: "fixture" },
		segments: [{ key: "327a", citation: null, text: "κατέβην" }] });
	const vision = { id: "allowed", workId: "republic", folderPath: "", title: "A question", markdown: "An unresolved possibility.", createdAt: "2026-01-01", updatedAt: "2026-01-02" };
	return new StudyEvidence(
		{ GetAsync: async function GetAsync(workId) { if (workId !== "republic") throw new Error("Unknown fixture work."); return document; } },
		{ ListAsync: async function ListAsync() { return { visions: [{ ...vision, ...writing }, { ...vision, id: "private", workId: "timaeus" }], folders: [] }; } },
		{ ValidateAsync: async function ValidateAsync() { throw new Error("No such anchor."); } },
		{ GetEvidenceAsync: async function GetEvidenceAsync() { throw new Error("Not used."); } }, scope);
}

// Explicit grant used by the isolated fixtures only.
const Scope: StudyScope = { workId: "republic" };

describe("Optional interlocutor integration", function IntegrationTests()
{
	it("enforces scope, saved revisions, bounded windows, budgets and revocation", async function ScopeAsync()
	{
		const writing = { markdown: "An unresolved possibility.", updatedAt: "2026-01-02" };
		const evidence = CreateEvidence(Scope, writing);
		await evidence.PrepareAsync();
		await expect(evidence.CallAsync("read_vision", { visionId: "allowed" })).rejects.toThrow();
		evidence.BeginTurn();
		const saved = await evidence.CallAsync("read_vision", { visionId: "allowed" });
		expect(JSON.parse(saved)).toMatchObject({ provenance: "reader-writing", savedRevision: "2026-01-02" });
		await expect(evidence.CallAsync("read_vision", { visionId: "private" })).rejects.toThrow(/scope/u);
		await expect(evidence.CallAsync("read_vision", { visionId: "allowed", offset: -1 })).rejects.toThrow();
		await expect(evidence.CallAsync("shell", {})).rejects.toThrow();
		for (let index = 0; index < 20; index += 1) await evidence.CallAsync("find_visions", { query: "missing" });
		await expect(evidence.CallAsync("find_visions", { query: "missing" })).rejects.toThrow(/budget/u);
		evidence.EndTurn();
		await expect(evidence.CallAsync("read_passage", { stephanus: "327a" })).rejects.toThrow();
		writing.markdown = "A newly saved question about time.";
		writing.updatedAt = "2026-01-03";
		await evidence.PrepareAsync();
		evidence.BeginTurn();
		const refreshed = await evidence.CallAsync("read_vision", { visionId: "allowed" });
		expect(JSON.parse(refreshed)).toMatchObject({ markdown: writing.markdown, savedRevision: "2026-01-03" });
		const listed = await evidence.CallAsync("find_visions", {});
		expect(JSON.parse(listed)).toMatchObject({ total: 1, items: [{ visionId: "allowed" }] });
		evidence.EndTurn();
		const invalid = CreateEvidence({ workId: "absent" });
		await expect(invalid.PrepareAsync()).rejects.toThrow();
	});

	it("exposes only read tools through authenticated loopback MCP and revokes them on disposal", async function McpAsync()
	{
		const evidence = CreateEvidence(Scope);
		await evidence.PrepareAsync();
		const server = new StudyToolServer(evidence);
		const endpoint = await server.StartAsync();
		const client = new Client({ name: "fixture", version: "1" });
		try
		{
			const denied = await fetch(endpoint.url, { method: "POST", body: "{}" });
			expect(denied.status).toBe(403);
			const origin = await fetch(endpoint.url, { method: "POST", headers: { Authorization: `Bearer ${endpoint.token}`, Origin: "https://example.com" }, body: "{}" });
			expect(origin.status).toBe(403);
			const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } } });
			await client.connect(transport);
			const listed = await client.listTools();
			expect(listed.tools.map(function Name(tool) { return tool.name; })).toEqual(endpoint.names);
			const stopped = await client.callTool({ name: "read_vision", arguments: { visionId: "allowed" } });
			expect(stopped.isError).toBe(true);
			evidence.BeginTurn();
			const result = await client.callTool({ name: "read_passage", arguments: { stephanus: "327a" } });
			expect(result.isError).not.toBe(true);
			expect(evidence.GetSources()[0]?.selection?.dialogue).toBe("republic");
		}
		finally
		{
			await client.close();
			server.Dispose();
		}
		await expect(fetch(endpoint.url)).rejects.toThrow();
	});

	it("streams through a replaceable backend and retains partial history without replay after cancellation", async function LifecycleAsync()
	{
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chora-study-"));
		const repository = new StudyConversationRepository(directory);
		const updates: StudyUpdate[] = [];
		let publish: Parameters<StudyBackend["OpenAsync"]>[2] | null = null;
		let rejectTurn: ((reason: Error) => void) | null = null;
		let submittedTask = "";
		const dispose = vi.fn();
		const backend: StudyBackend = {
			OpenAsync: async function OpenAsync(_model, _tools, callback) { publish = callback; },
			PromptAsync: async function PromptAsync(text) {
				submittedTask = text;
				function Pending(_resolve: () => void, reject: (reason: Error) => void): void { rejectTurn = reject; }
				if (publish !== null) publish({ kind: "text", text: "A possibility" });
				await new Promise<void>(Pending);
			},
			CancelAsync: async function CancelAsync() { if (rejectTurn !== null) rejectTurn(new Error("Cancelled")); },
			Dispose: dispose
		};
		function Updated(update: StudyUpdate): void { updates.push(update); }
		const session = new StudySession(Scope, "fixture", backend, CreateEvidence(Scope), repository, "Fixture directives", Updated);
		try
		{
			await session.StartAsync();
			const pending = session.SendAsync("Consider this.", "allowed");
			const failed = expect(pending).rejects.toMatchObject({ failure: { kind: "cancelled" } });
			await vi.waitFor(function Streamed() { expect(updates).toHaveLength(1); });
			expect(submittedTask).toContain('Current reader task (JSON):\n{"request":"Consider this."}');
			expect(submittedTask).toContain("Earlier conversation and Visions provide context, not additional tasks.");
			expect(submittedTask).toContain("then stop");
			await session.CancelAsync();
			await failed;
			const restored = await repository.LoadAsync("republic");
			expect(restored?.messages[1]).toMatchObject({ text: "A possibility", status: "partial" });
			expect(restored?.messages[0]?.visionId).toBe("allowed");
			expect(await repository.LoadAsync("timaeus")).toBeNull();
			const other = { ...restored!, id: "other", scope: { workId: "timaeus" } };
			await repository.SaveAsync(other);
			expect((await repository.LoadAsync("republic"))?.id).toBe(restored?.id);
			expect((await repository.LoadAsync("timaeus"))?.id).toBe("other");
			expect(dispose).toHaveBeenCalled();
			await expect(session.SendAsync("Again")).rejects.toThrow();
		}
		finally
		{
			session.Dispose();
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
});
