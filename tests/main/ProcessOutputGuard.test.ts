import { describe, expect, it } from "vitest";
import { HandleProcessOutputError } from "../../src/main/diagnostics/ProcessOutputGuard.js";

describe("ProcessOutputGuard", function ProcessOutputGuardTests()
{
	it("accepts a closed output pipe", () =>
	{
		const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });

		expect(() => HandleProcessOutputError(error)).not.toThrow();
	});

	it("does not suppress other output failures", () =>
	{
		const error = Object.assign(new Error("output failed"), { code: "EIO" });

		expect(() => HandleProcessOutputError(error)).toThrow(error);
	});
});
