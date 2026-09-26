import { validatePath } from '../../../src/domain/paths';
import { AppFault } from '../../../src/types/errors';
import type { Entry, FileSystemPort, TextFile } from '../../../src/types/filesystem';
import { sha256 } from '../../../src/utils/hash';

export class MemoryFileSystem implements FileSystemPort {
  readonly name = 'Synthetic Workspace';
  readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();
  fail: ((path: string) => boolean) | null = null;
  async read(path: readonly string[]): Promise<TextFile | null> {
    validatePath(path);
    const text = this.files.get(path.join('/'));
    return text === undefined
      ? null
      : {
          text,
          hash: await sha256(text),
          size: new TextEncoder().encode(text).length,
          lastModified: 0,
        };
  }
  async list(path: readonly string[]): Promise<Entry[]> {
    validatePath(path, true);
    const prefix = path.length ? `${path.join('/')}/` : '';
    const entries = new Map<string, Entry>();
    for (const key of [...this.dirs, ...this.files.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length),
        name = rest.split('/')[0];
      if (!name) continue;
      entries.set(name, {
        name,
        kind: rest.includes('/') || this.dirs.has(`${prefix}${name}`) ? 'directory' : 'file',
      });
    }
    return [...entries.values()];
  }
  async ensureDirectory(path: readonly string[]): Promise<void> {
    validatePath(path);
    for (let i = 1; i <= path.length; i++) this.dirs.add(path.slice(0, i).join('/'));
  }
  async write(path: readonly string[], text: string, expectedHash: string | null): Promise<void> {
    validatePath(path);
    const key = path.join('/');
    if (this.fail?.(key)) throw new AppFault('WRITE_FAILED');
    if (((await this.read(path))?.hash ?? null) !== expectedHash) throw new AppFault('CONFLICT');
    if (path.length > 1) await this.ensureDirectory(path.slice(0, -1));
    this.files.set(key, text);
  }
  async removeGeneratedFile(path: readonly string[], expectedHash: string): Promise<void> {
    if ((await this.read(path))?.hash !== expectedHash) throw new AppFault('CONFLICT');
    this.files.delete(path.join('/'));
  }
  async cleanupPending(operationId: string): Promise<void> {
    const prefix = `.promptdesk/pending/${operationId}`;
    for (const key of this.files.keys()) if (key.startsWith(`${prefix}/`)) this.files.delete(key);
    for (const key of this.dirs)
      if (key === prefix || key.startsWith(`${prefix}/`)) this.dirs.delete(key);
  }
}
