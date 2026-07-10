// In-memory attachment byte store for the web host.
//
// The composer produces a FileAttachment { id, label } and the cloud-upload
// pipeline later reads the bytes back via CLOUD_ARTIFACT_READ_FILE_AS_BASE64
// (id -> base64). On desktop the id is a real filesystem path written by the
// os.saveClipboard* handlers (Node fs) and read back by fs.readFileAsBase64.
//
// A browser has no filesystem, but the id is opaque — nothing requires it to be
// a path. So on web the os.saveClipboard* handlers stash the browser-computed
// base64 here under a synthetic id, and webReadFileAsBase64 reads it back. The
// entire presigned-POST upload pipeline (fetch/FormData/Blob in
// CloudArtifactService) is already portable and needs no changes.
//
// Bytes live only for the lifetime of the tab; an attachment is uploaded to the
// cloud run shortly after it's added, so there's no need to persist them.

interface StoredAttachment {
  base64Data: string;
  name: string;
  mimeType?: string;
}

const attachments = new Map<string, StoredAttachment>();

/** Store attachment bytes and return the synthetic id used as FileAttachment.id. */
export function putWebAttachment(entry: StoredAttachment): {
  path: string;
  name: string;
  mimeType?: string;
} {
  // Leading slash so the id reads as an absolute path: the cloud-prompt
  // transport only keeps <file path> tags that pass isAbsolutePath, so a
  // non-absolute id would be silently dropped before upload.
  const id = `/web-attachment/${crypto.randomUUID()}`;
  attachments.set(id, entry);
  return { path: id, name: entry.name, mimeType: entry.mimeType };
}

/** Read attachment bytes back as base64 for cloud upload (null if unknown). */
export function getWebAttachmentBase64(id: string): string | null {
  return attachments.get(id)?.base64Data ?? null;
}
