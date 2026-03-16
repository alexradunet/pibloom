// Extension-specific types for bloom-os

/** Parsed container info from podman ps JSON output. */
export interface ContainerInfo {
	Names?: string[];
	Status?: string;
	State?: string;
	Image?: string;
}

/** Update status persisted to /home/pi/.bloom/update-status.json by the bloom-update.service. */
export interface UpdateStatus {
	available: boolean;
	checked: string;
	generation?: string;   // NixOS generation number
	notified?: boolean;
}
