import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ParseTeiWork } from "../../scripts/corpus/TeiParser.js";

const SourcePath = path.resolve("corpus", "source", "data", "tlg0059", "tlg030", "tlg0059.tlg030.perseus-grc2.xml");

describe("Republic corpus import", () =>
{
	it("preserves book divisions, paragraph boundaries, and Stephanus references", () =>
	{
		const sourceText = fs.readFileSync(SourcePath, "utf8");
		const work = ParseTeiWork(sourceText, "tlg0059.tlg030.perseus-grc2.xml");
		const text = work.segments.map((segment) => segment.text).join(" ");
		const firstLocator = work.segments[0]?.citation?.value;
		const hasSectionB = work.segments.some((segment) => segment.citation?.value === "327b");
		const hasParagraphBoundary = work.segments.filter((segment) => segment.citation?.value === "327c").length > 1;
		const bookNumbers = [...new Set(work.segments.map((segment) => segment.division?.type === "book" ? segment.division.label : null).filter((value) => value !== null))];

		expect(work.segments.length).toBeGreaterThan(1000);
		expect(text.length).toBeGreaterThan(500000);
		expect(work.segments.every((segment) => segment.text.length > 0)).toBe(true);
		expect(text).not.toContain("\t");
		expect(firstLocator).toBe("327a");
		expect(hasSectionB).toBe(true);
		expect(hasParagraphBoundary).toBe(true);
		expect(bookNumbers).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
	});

	it("preserves the Pindar fragment as verse with its bibliography", () =>
	{
		const sourceText = fs.readFileSync(SourcePath, "utf8");
		const work = ParseTeiWork(sourceText, "tlg0059.tlg030.perseus-grc2.xml");
		const segment = work.segments.find(function ContainsPindar(candidate): boolean
		{
			return candidate.text.includes("γλυκεῖά οἱ καρδίαν");
		});
		const quotation = segment?.annotations?.find(function IsQuotation(annotation): boolean
		{
			return annotation.kind === "quotation";
		});
		const citation = segment?.annotations?.find(function IsCitation(annotation): boolean
		{
			return annotation.kind === "citation";
		});

		expect(segment).toBeDefined();
		expect(segment?.text.slice(quotation?.start, quotation?.end)).toBe("γλυκεῖά οἱ καρδίαν\nἀτάλλοισα γηροτρόφος συναορεῖ\nἐλπὶς ἃ μάλιστα θνατῶν πολύστροφον\nγνώμαν κυβερνᾷ.");
		expect(segment?.text.slice(citation?.start, citation?.end)).toBe("Pindar Frag. 214, Loeb");
		expect(segment?.text).toContain("διαγάγῃ,\nγλυκεῖά");
		expect(segment?.text).toContain("Loeb\nεὖ οὖν λέγει");
	});

	it("keeps uncited prose quotations inline", () =>
	{
		const sourceText = fs.readFileSync(SourcePath, "utf8");
		const work = ParseTeiWork(sourceText, "tlg0059.tlg030.perseus-grc2.xml");
		const segment = work.segments.find(function ContainsOldAgeThreshold(candidate): boolean
		{
			return candidate.text.includes("ἐπὶ γήραος οὐδῷ");
		});

		expect(segment).toBeDefined();
		expect(segment?.annotations).toBeUndefined();
		expect(segment?.text).toContain("ὃ δὴ ἐπὶ γήραος οὐδῷ φασιν εἶναι οἱ ποιηταί");
		expect(segment?.text).not.toContain("\nἐπὶ γήραος οὐδῷ\n");
	});
});
