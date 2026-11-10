/** One file kept in the attachment store: sent in a message by a person, or attached by a bot. */
export const FILE_MAX_BYTES = 1024 * 1024 * 1024;
/** Anything read whole into memory: an inline image or a video or audio preview in the browser, a voice note served
 * from memory. Larger files still save and download; they just do not play inline. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const BROWSER_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const MEGABYTE = 1024 * 1024;
/** A limit in the same whole megabytes the person reads elsewhere ("100 MB"). */
export const limitMegabytes = (bytes: number): number => Math.round(bytes / MEGABYTE);
