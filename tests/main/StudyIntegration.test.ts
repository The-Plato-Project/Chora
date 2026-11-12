import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";
import { LibraryService } from "../../src/main/library/LibraryService.js";
import { StudyEvidence } from "../../src/main/study/StudyEvidence.js";
import { StudyToolServer } from "../../src/main/study/StudyToolServer.js";
import { StudySession } from "../../src/main/study/StudySession.js";
import { StudyConversationRepository } from "../../src/main/study/StudyConversationRepository.js";
import type { WordEvidenceResult } from "../../src/shared/library/WordExplorationTypes.js";
import type { StudyBackend } from "../../src/main/study/StudyBackend.js";
import type { StudyScope, StudyUpdate } from "../../src/shared/study/StudyTypes.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Disposable canonical material prevents integration checks from reading personal documents.
function CreateEvidence(scope: StudyScope): StudyEvidence
{
	const document = TextDocument.FromSnapshot({ id: "republic", textVersion: `sha256:${"0".repeat(64)}`,
		urn: null, title: "Republic", titleGreek: null, author: "Plato", language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "fixture", commit: "fixture", sourceFile: "fixture", license: "fixture" },
		segments: [{ key: "327a", citation: null, text: "κατέβην" }] });
	const library = new LibraryService({ GetAsync: async function GetAsync(workId) { if (workId !== "republic") throw new Error("Unknown fixture work."); return document; }, ListAsync: async function ListAsync() { return []; } });
	const selection = document.CreateSelection({ stephanus: "327a", offset: 0 }, { stephanus: "327a", offset: 7 });
	const lexical: WordEvidenceResult = {
		contract: "platosi.lexical-evidence.v1", selection: null, work: { dialogue: "republic", text_version: document.textVersion },
		occurrencesStatus: "indexed", form: "καταβαίνω", context: [], possibilities: [],
		lemmas: [{ lemma: "καταβαίνω", candidates: [], relatedLemmas: [], forms: [{ form: "κατέβην", total: 1, evidence: [], occurrences: [{ selection, passage: "κατέβην", citation: null, division: null }] }] }],
		dictionary: { status: "available", possiblyTruncated: false, entries: [{ provider: "fixture", providerVersion: "1", headword: "καταβαίνω", matchedTerm: "καταβαίνω", entryId: "fixture", plainText: "go down", entryXml: "", source: { attribution: "fixture", revision: "1", repository: "fixture" }, license: {} }] },
		morphology: { status: "available", provider: null, normalization: null, spellingSuggestions: null, formAttestation: null, lemmas: [], artifacts: null },
		warnings: [], limitations: "Synthetic fixture only."
	};
	return new StudyEvidence(library, { GetLexicalEvidenceAsync: async function GetLexicalEvidenceAsync(lemma) { return lemma === "καταβαίνω" ? lexical : { ...lexical, dictionary: { ...lexical.dictionary, entries: [] } }; } }, scope);
}

// Explicit grant used by the isolated fixtures only.
const Scope: StudyScope = { workId: "republic" };

describe("Optional interlocutor integration", function IntegrationTests()
{
	it("retrieves dictionary-backed candidates, rejects writing access and checks quotations and scope", async function ScopeAsync()
	{
		const evidence = CreateEvidence(Scope);
		await evidence.PrepareAsync();
		await expect(evidence.CallAsync("read_passage", { stephanus: "327a" })).rejects.toThrow();
		evidence.BeginTurn();
		const found = JSON.parse(await evidence.CallAsync("find_topic_passages", { terms: [{ lemma: "καταβαίνω", reason: "Model proposal" }, { lemma: "μετ(ά)", reason: "Malformed alternative" }] }));
		expect(found).toMatchObject({ total: 1, vocabulary: [{ proposal: { lemma: "καταβαίνω" }, occurrences: 1 }], candidates: [{ stephanus: "327a", greek: "κατέβην", matches: [{ form: "κατέβην" }] }] });
		expect(found).toMatchObject({ inputStatus: "searched-accepted-terms", rejectedTerms: [{ index: 1, lemma: "μετ(ά)" }] });
		expect(await evidence.CheckCitationsAsync('327a: “κατέβην”')).toMatchObject({ unverified: [], unverifiedQuotes: [] });
		expect(await evidence.CheckCitationsAsync('108a: «χρόνος»')).toMatchObject({ unverified: ["108a"], unverifiedQuotes: ["χρόνος"] });
		await expect(evidence.CallAsync("read_vision", {})).rejects.toThrow(/experiment/u);
		await expect(evidence.CallAsync("find_visions", {})).rejects.toThrow(/experiment/u);
		const invalidTerms = JSON.parse(await evidence.CallAsync("find_topic_passages", { terms: [{ lemma: "time", reason: "invalid" }] }));
		expect(invalidTerms).toMatchObject({ inputStatus: "invalid-input-not-searched", vocabulary: [], candidates: [], rejectedTerms: [{ lemma: "time" }] });
		await evidence.CallAsync("read_passage", { stephanus: "327a" });
		await evidence.CallAsync("read_passage", { stephanus: "327a" });
		expect(JSON.parse(await evidence.CallAsync("read_passage", { stephanus: "327a" }))).toMatchObject({ retrieval: { remainingCalls: 0, closed: true } });
		evidence.EndTurn();
		await expect(evidence.CallAsync("read_passage", { stephanus: "327a" })).rejects.toThrow();
		evidence.BeginTurn();
		expect(await evidence.CheckCitationsAsync('327a')).toMatchObject({ unverified: ["327a"] });
		const missing = JSON.parse(await evidence.CallAsync("find_topic_passages", { terms: [{ lemma: "χρόνος", reason: "No fixture entry" }] }));
		expect(missing).toMatchObject({ total: 0, candidates: [], vocabulary: [{ occurrences: 0, dictionary: [] }] });
		const description = JSON.parse(await evidence.DescribeAsync());
		expect(description).toMatchObject({ experiment: "canonical-topic-retrieval-v1" });
		expect(description).not.toHaveProperty("openVision");
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
			expect(endpoint.names).toEqual(["find_topic_passages", "read_passage"]);
			expect(listed.tools.map(function Name(tool) { return tool.name; })).toEqual(endpoint.names);
			const stopped = await client.callTool({ name: "read_vision", arguments: { visionId: "allowed" } });
			expect(stopped.isError).toBe(true);
			evidence.BeginTurn();
			const result = await client.callTool({ name: "read_passage", arguments: { stephanus: "327a" } });
			expect(result.isError).not.toBe(true);
			expect(evidence.GetSources()[0]?.selection?.dialogue).toBe("republic");
			const invalid = await client.callTool({ name: "find_topic_passages", arguments: {} });
			expect(invalid.isError).toBe(true);
			expect(JSON.stringify(invalid)).toContain("INVALID_TOPIC_TERMS");
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
			const pending = session.SendAsync("Consider this.");
			const failed = expect(pending).rejects.toMatchObject({ failure: { kind: "cancelled" } });
			await vi.waitFor(function Streamed() { expect(updates).toHaveLength(1); });
			expect(submittedTask).toContain('Current reader task (JSON):\n{"request":"Consider this."}');
			expect(submittedTask).toContain("call find_topic_passages");
			expect(submittedTask).toContain("At most six calls");
			expect(submittedTask).toContain("and stop");
			await session.CancelAsync();
			await failed;
			const restored = await repository.LoadAsync("republic");
			expect(restored?.messages[1]).toMatchObject({ text: "A possibility", status: "partial" });
			expect(await repository.LoadAsync("timaeus")).toBeNull();
			const other = { ...restored!, id: "other", scope: { workId: "timaeus" } };
			await repository.SaveAsync(other);
			expect((await repository.LoadAsync("republic"))?.id).toBe(restored?.id);
			expect((await repository.LoadAsync("timaeus"))?.id).toBe("other");
			expect(dispose).toHaveBeenCalled();
			await expect(session.SendAsync("Again")).rejects.toThrow();
			const checkedEvidence = CreateEvidence(Scope);
			let correctedPublish: Parameters<StudyBackend["OpenAsync"]>[2] | null = null;
			let prompts = 0;
			let failCorrection = false;
			const checkedBackend: StudyBackend = {
				OpenAsync: async function OpenAsync(_model, _tools, callback) { correctedPublish = callback; },
				PromptAsync: async function PromptAsync() {
					prompts += 1;
					if (prompts === 1) await checkedEvidence.CallAsync("read_passage", { stephanus: "327a" });
					else await expect(checkedEvidence.CallAsync("read_passage", { stephanus: "327a" })).rejects.toThrow();
					correctedPublish?.({ kind: "text", text: prompts === 1 || failCorrection ? "Invented passage 108a." : "Republic 327a: κατέβην." });
				},
				CancelAsync: async function CancelAsync() {},
				Dispose: function Dispose() {}
			};
			const checkedSession = new StudySession(Scope, "fixture", checkedBackend, checkedEvidence, repository, "Fixture", Updated);
			try
			{
				await checkedSession.StartAsync();
				const corrected = await checkedSession.SendAsync("Find a passage.");
				expect(prompts).toBe(2);
				expect(corrected.messages.at(-1)).toMatchObject({ text: "Republic 327a: κατέβην.", status: "complete" });
				expect(updates.some(function Replaced(update) { return update.kind === "replace"; })).toBe(true);
				prompts = 0;
				failCorrection = true;
				const rejected = await checkedSession.SendAsync("Try another passage.");
				expect(rejected.messages.at(-1)?.status).toBe("partial");
				expect(rejected.messages.at(-1)?.text).not.toContain("108a");
			}
			finally
			{
				checkedSession.Dispose();
			}
		}
		finally
		{
			session.Dispose();
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
});
