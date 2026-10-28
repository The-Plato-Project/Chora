// Stable categories used by domain owners and the IPC failure contract.
export type FailureKind = "validation" | "not-found" | "conflict" | "cancelled" | "io" | "provider" | "unexpected" | "transport";

// Recovery advice never authorizes an automatic retry of a privileged command.
export type FailureRecovery = "correct-input" | "reload" | "retry" | "inspect-state" | "none";

// Serializable failure metadata; original exception details stay in diagnostic logs.
export interface OperationFailure
{
	// Stable classification independent of presentation wording.
	readonly code: string;
	// Category used to distinguish expected rejection from infrastructure failure.
	readonly kind: FailureKind;
	// Safe explanation supplied by the owning boundary.
	readonly message: string;
	// Suggested next step, without implicitly repeating the operation.
	readonly recovery: FailureRecovery;
	// A failed multi-file or transport operation must not imply that nothing changed.
	readonly outcome: "not-completed" | "unknown" | "applied";
	// Links renderer reporting to the main-process diagnostic record.
	readonly diagnosticId: string;
	// Command or workflow whose outcome this failure describes.
	readonly operation: string;
}

// All privileged IPC requests resolve to an explicit success or failure envelope.
export type OperationResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: OperationFailure };

// Carries an expected domain failure or a reconstructed IPC failure within one process.
export class ApplicationError extends Error
{
	// Structured, serializable failure, including a correlation reference when available.
	public readonly failure: OperationFailure;

	// Creates a classified error while preserving its original technical cause locally.
	public constructor(failure: OperationFailure, cause?: unknown)
	{
		super(failure.message, { cause });
		this.name = "ApplicationError";
		this.failure = failure;
	}

	// Creates an expected failure at the domain or command owner.
	public static Expected(kind: "validation" | "not-found" | "conflict" | "cancelled", code: string, message: string): ApplicationError
	{
		const recovery: FailureRecovery = kind === "validation" ? "correct-input" : kind === "conflict" || kind === "not-found" ? "reload" : "none";
		const failure: OperationFailure = { kind, code, message, recovery, outcome: "not-completed", diagnosticId: "", operation: "" };
		const error = new ApplicationError(failure);

		return error;
	}
}

// Converts a plain boundary response into a process-local error without relying on bridged Error properties.
export async function ReadOperationAsync<T>(response: Promise<OperationResult<T>>): Promise<T>
{
	let result: OperationResult<T>;
	try
	{
		result = await response;
	}
	catch (cause)
	{
		const failure: OperationFailure = { kind: "transport", code: "IPC_UNAVAILABLE", message: "The application connection was interrupted. Check the current state before trying again.", recovery: "inspect-state", outcome: "unknown", diagnosticId: "", operation: "IPC" };
		throw new ApplicationError(failure, cause);
	}
	if (result === null || typeof result !== "object" || typeof result.ok !== "boolean")
	{
		throw ApplicationError.Expected("conflict", "INVALID_IPC_RESPONSE", "The application returned an invalid operation response.");
	}
	if (!result.ok)
	{
		const failure = result.error;
		if (!IsOperationFailure(failure))
		{
			throw ApplicationError.Expected("conflict", "INVALID_IPC_FAILURE", "The application returned invalid failure information.");
		}
		throw new ApplicationError(failure);
	}
	const value = result.value;

	return value;
}

// Validates plain failure metadata at IPC and diagnostic-ingestion boundaries.
export function IsOperationFailure(value: unknown): value is OperationFailure
{
	let valid = false;
	if (value !== null && typeof value === "object")
	{
		const failure = value as Record<string, unknown>;
		valid = typeof failure.code === "string" && failure.code.length <= 100
			&& typeof failure.message === "string" && failure.message.length <= 16000
			&& typeof failure.diagnosticId === "string" && failure.diagnosticId.length <= 36
			&& typeof failure.operation === "string" && failure.operation.length <= 160
			&& ["validation", "not-found", "conflict", "cancelled", "io", "provider", "unexpected", "transport"].includes(String(failure.kind))
			&& ["correct-input", "reload", "retry", "inspect-state", "none"].includes(String(failure.recovery))
			&& ["not-completed", "unknown", "applied"].includes(String(failure.outcome));
	}

	return valid;
}
