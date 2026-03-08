export const MEDIA_TYPES: Record<string, string> = {
	audioMessage: "audio",
	imageMessage: "image",
	videoMessage: "video",
	documentMessage: "document",
	stickerMessage: "sticker",
};

export function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		"audio/ogg": "ogg",
		"audio/ogg; codecs=opus": "ogg",
		"audio/mpeg": "mp3",
		"audio/mp4": "m4a",
		"audio/wav": "wav",
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif",
		"video/mp4": "mp4",
		"video/3gpp": "3gp",
		"application/pdf": "pdf",
		"application/octet-stream": "bin",
	};
	return map[mime] ?? mime.split("/").pop() ?? "bin";
}

export interface ChannelMessage {
	type: string;
	to?: string;
	text?: string;
}

export function isChannelMessage(val: unknown): val is ChannelMessage {
	return (
		typeof val === "object" &&
		val !== null &&
		"type" in val &&
		typeof (val as Record<string, unknown>).type === "string"
	);
}

export function parseAllowedSenders(raw: string): Set<string> {
	const entries = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return new Set(entries);
}

export function isWhatsAppSenderAllowed(jid: string, allowedSenders: Set<string>): boolean {
	if (allowedSenders.size === 0) return true;
	if (allowedSenders.has(jid)) return true;
	const number = jid.split("@")[0];
	if (allowedSenders.has(number)) return true;
	if (allowedSenders.has(`+${number}`)) return true;
	return false;
}
