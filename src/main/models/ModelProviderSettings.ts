import { CreateProviderError } from "./ModelProviderError.js";

export const DefaultKimiBaseUrl = "https://api.moonshot.ai/v1";
export const DefaultKimiModel = "kimi-k2.6";
export const DefaultKimiMaxCompletionTokens = 3000;
export const DefaultCopilotRelayPort = 4319;

export function GetRequiredValue(keys: string[], displayName: string): string
{
	let value = "";

	for (const key of keys)
	{
		const candidate = process.env[key];
		const hasCandidate = candidate !== undefined;
		const containsText = candidate?.trim().length !== 0;

		if (hasCandidate && containsText && value.length === 0)
		{
			value = candidate;
		}
	}

	if (value.length === 0)
	{
		const error = CreateProviderError("configuration", `${displayName} is missing. Add it to .env.local and try again.`);

		throw error;
	}

	return value;
}

export function GetOptionalValue(key: string, defaultValue: string): string
{
	const configuredValue = process.env[key];
	const trimmedValue = configuredValue?.trim() ?? "";
	const hasConfiguredValue = trimmedValue.length > 0;
	let value = defaultValue;

	if (hasConfiguredValue)
	{
		value = trimmedValue;
	}

	return value;
}

export function GetOptionalPositiveIntegerValue(key: string, defaultValue: number): number
{
	const configuredValue = GetOptionalValue(key, defaultValue.toString());
	const value = Number.parseInt(configuredValue, 10);
	const isValid = Number.isSafeInteger(value) && value > 0;
	let result = defaultValue;

	if (isValid)
	{
		result = value;
	}

	return result;
}
