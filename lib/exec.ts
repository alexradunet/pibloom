import { execa } from "execa";

/** Result of running a shell command via {@link run}. */
export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Execute a command with arguments, returning stdout, stderr, and exit code.
 * Never throws — failed commands return a non-zero exitCode with stderr populated.
 *
 * @param cmd - The executable to run.
 * @param args - Arguments passed to the executable.
 * @param signal - Optional AbortSignal to cancel the process.
 * @param cwd - Optional working directory for the child process.
 * @param env - Optional extra environment variables (merged with process.env by execa).
 */
export async function run(
	cmd: string,
	args: string[],
	signal?: AbortSignal,
	cwd?: string,
	env?: Record<string, string>,
): Promise<RunResult> {
	const result = await execa(cmd, args, { reject: false, cancelSignal: signal, cwd, env });
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? 1 };
}
