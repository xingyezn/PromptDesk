import { validatePath } from '../../domain/paths';
import { AppFault, normalizeError } from '../../types/errors';
import type { Entry, FileSystemPort, TextFile } from '../../types/filesystem';
import { sha256 } from '../../utils/hash';

const maxSize = 5 * 1024 * 1024;
export class NativeFileSystem implements FileSystemPort {
  constructor(private readonly root: FileSystemDirectoryHandle) {}
  get name() {
    return this.root.name;
  }
  static supported(): boolean {
    return window.isSecureContext && 'showDirectoryPicker' in window;
  }
  static async pick(): Promise<NativeFileSystem> {
    if (!this.supported()) throw new AppFault('UNSUPPORTED');
    try {
      return new NativeFileSystem(await window.showDirectoryPicker({ mode: 'readwrite' }));
    } catch (error) {
      throw normalizeError(error);
    }
  }
  getHandle(): FileSystemDirectoryHandle {
    return this.root;
  } // Only cache/workspace services consume this.
  static sameEntry(first: FileSystemDirectoryHandle, second: FileSystemDirectoryHandle) {
    return first.isSameEntry(second);
  }
  queryPermission(): Promise<PermissionState> {
    return this.root.queryPermission({ mode: 'readwrite' });
  }
  async authorize(): Promise<void> {
    if ((await this.root.requestPermission({ mode: 'readwrite' })) !== 'granted')
      throw new AppFault('PERMISSION_DENIED');
  }
  private async directory(
    path: readonly string[],
    create = false,
  ): Promise<FileSystemDirectoryHandle> {
    validatePath(path, true);
    let dir = this.root;
    for (const segment of path) dir = await dir.getDirectoryHandle(segment, { create });
    return dir;
  }
  async read(path: readonly string[]): Promise<TextFile | null> {
    validatePath(path);
    try {
      const dir = await this.directory(path.slice(0, -1));
      const handle = await dir.getFileHandle(path.at(-1)!);
      const file = await handle.getFile();
      if (file.size > maxSize) throw new AppFault('INVALID_SCHEMA');
      const text = await file.text();
      return { text, hash: await sha256(text), size: file.size, lastModified: file.lastModified };
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') return null;
      throw normalizeError(error);
    }
  }
  async list(path: readonly string[]): Promise<Entry[]> {
    try {
      const dir = await this.directory(path);
      const entries: Entry[] = [];
      for await (const entry of dir.values()) entries.push({ name: entry.name, kind: entry.kind });
      return entries;
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') return [];
      throw normalizeError(error);
    }
  }
  async ensureDirectory(path: readonly string[]): Promise<void> {
    try {
      await this.directory(path, true);
    } catch (error) {
      throw normalizeError(error);
    }
  }
  async write(path: readonly string[], text: string, expectedHash: string | null): Promise<void> {
    validatePath(path);
    if (new TextEncoder().encode(text).byteLength > maxSize) throw new AppFault('INVALID_SCHEMA');
    const before = await this.read(path);
    if ((before?.hash ?? null) !== expectedHash) throw new AppFault('CONFLICT');
    let stream: FileSystemWritableFileStream | undefined;
    try {
      const dir = await this.directory(path.slice(0, -1), true);
      const handle = await dir.getFileHandle(path.at(-1)!, { create: true });
      stream = await handle.createWritable();
      await stream.write(text);
      await stream.close();
      if ((await this.read(path))?.hash !== (await sha256(text)))
        throw new AppFault('WRITE_FAILED');
    } catch (error) {
      try {
        await stream?.abort();
      } catch {
        /* Preserve original failure. */
      }
      throw normalizeError(error);
    }
  }
  async removeGeneratedFile(path: readonly string[], expectedHash: string): Promise<void> {
    const before = await this.read(path);
    if (before?.hash !== expectedHash) throw new AppFault('CONFLICT');
    const dir = await this.directory(path.slice(0, -1));
    await dir.removeEntry(path.at(-1)!);
  }
  async cleanupPending(operationId: string): Promise<void> {
    if (!/^op_[0-9a-f-]{36}$/.test(operationId)) throw new AppFault('PATH_INVALID');
    const dir = await this.directory(['.promptdesk', 'pending']);
    await dir.removeEntry(operationId, { recursive: true });
  }
}
