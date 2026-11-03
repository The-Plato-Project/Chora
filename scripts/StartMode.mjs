import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronEnvironment = { ...process.env };
delete electronEnvironment.ELECTRON_RUN_AS_NODE;

await import("./BuildDebug.mjs");

const executableName = process.platform === "win32" ? "electron.exe" : "electron";
const electronExecutable = path.join(rootPath, "node_modules", "electron", "dist", executableName);
const child = spawn(electronExecutable, ["."], {
	cwd: rootPath,
	stdio: "inherit",
	env: electronEnvironment
});

child.once("exit", function SetExitCode(exitCode)
{
	process.exitCode = exitCode ?? 1;
});

child.once("error", function ReportError(error)
{
	console.error(error.message);
	process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"])
{
	process.once(signal, function StopChora()
	{
		if (child.exitCode === null) child.kill(signal);
	});
}
