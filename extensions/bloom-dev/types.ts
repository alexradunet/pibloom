// Extension-specific types for bloom-dev

/** Current state of the development environment. */
export interface DevStatus {
	enabled: boolean;
	repoConfigured: boolean;
	codeServerRunning: boolean;
	localBuildAvailable: boolean;
	repoPath?: string;
	localImageTag?: string;
}

/** Result of a local container image build. */
export interface DevBuildResult {
	success: boolean;
	imageTag: string;
	duration: number;
	size?: string;
	error?: string;
}

/** Result of running the test/lint suite. */
export interface DevTestResult {
	success: boolean;
	testsPassed: boolean;
	lintPassed: boolean;
	testOutput: string;
	lintOutput: string;
}
