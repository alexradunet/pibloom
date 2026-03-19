// Extension-specific types for os

/** Update status persisted to the primary Garden user's ~/.garden/update-status.json. */
export interface UpdateStatus {
	available: boolean;
	checked: string;
	generation?: string; // NixOS generation number
	notified?: boolean;
}
