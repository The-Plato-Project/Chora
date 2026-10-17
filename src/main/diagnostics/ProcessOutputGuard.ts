// Prevents an optional console destination from terminating the Electron main process.
export function HandleProcessOutputError(error: Error): void
{
	const code = (error as NodeJS.ErrnoException).code;
	if (code !== "EPIPE") throw error;
}

export function InstallProcessOutputGuard(): void
{
	process.stdout.on("error", HandleProcessOutputError);
	process.stderr.on("error", HandleProcessOutputError);
}
