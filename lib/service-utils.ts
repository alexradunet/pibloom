/** Validate that a service name is kebab-case `[a-z0-9-]`. Returns error message or null. */
export function validateServiceName(name: string): string | null {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		return "Service name must be kebab-case using [a-z0-9-].";
	}
	return null;
}

/** Validate that a container image reference is pinned (digest or explicit non-latest tag). Returns error message or null. */
export function validatePinnedImage(image: string): string | null {
	if (image.includes("@sha256:")) return null;
	const tagMatch = image.match(/:([^/@]+)$/);
	if (!tagMatch) {
		return "Image must include an explicit version tag or digest (avoid implicit latest).";
	}
	const tag = tagMatch[1].toLowerCase();
	if (tag === "latest" || tag.startsWith("latest-")) {
		return "Image tag must be pinned (avoid latest/latest-* tags).";
	}
	return null;
}

/** Extract a `sha256:...` digest from a string. Returns null if not found. */
export function extractDigest(text: string): string | null {
	const match = text.match(/sha256:[a-f0-9]{64}/i);
	return match ? match[0].toLowerCase() : null;
}

/** Check if an error message indicates a missing command (ENOENT, not found, etc.). */
export function commandMissingError(text: string): boolean {
	return /ENOENT|not found|No such file/i.test(text);
}
