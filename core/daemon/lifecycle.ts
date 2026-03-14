export interface RetryOptions {
	initialDelayMs?: number;
	maxDelayMs?: number;
	sleep?: (delayMs: number) => Promise<void>;
	onRetry?: (error: unknown, retryDelayMs: number) => void;
}

export async function startWithRetry(
	startFn: () => Promise<void>,
	onError?: () => Promise<void>,
	options: RetryOptions = {},
): Promise<void> {
	let retryDelay = options.initialDelayMs ?? 5000;
	const maxDelay = options.maxDelayMs ?? 300_000;
	const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

	while (true) {
		try {
			await startFn();
			break;
		} catch (error) {
			if (onError) await onError();
			options.onRetry?.(error, retryDelay);
			await sleep(retryDelay);
			retryDelay = Math.min(retryDelay * 3, maxDelay);
		}
	}
}
