import { zipSync, strToU8 } from 'fflate';
import type { WorkspaceSnapshot } from './snapshot';

export function encodeArchive(snapshot: WorkspaceSnapshot): Uint8Array {
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const file of snapshot.files) files[file.path.join('/')] = strToU8(file.text);
  return zipSync(files, { level: 1 });
}
export function downloadArchive(snapshot: WorkspaceSnapshot): void {
  const data = encodeArchive(snapshot);
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `PromptDesk-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser download subsystem time to retain the blob before revocation.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
