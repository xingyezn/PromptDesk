import { zipSync, strToU8 } from 'fflate';
import type { CloudExport } from '../../domain/cloud';
import { archiveSegment, cloudArchiveFiles } from '../../domain/cloudExport';

export function downloadCloudArchive(data: CloudExport, label: string): void {
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const file of cloudArchiveFiles(data)) files[file.path] = strToU8(file.content);
  const zipped = zipSync(files, { level: 1 });
  const url = URL.createObjectURL(new Blob([new Uint8Array(zipped)], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `PromptDesk-${archiveSegment(label, 'export')}-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser download subsystem time to retain the blob before revocation.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
