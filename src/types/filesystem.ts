export interface TextFile {
  text: string;
  hash: string;
  size: number;
  lastModified: number;
}
export interface Entry {
  name: string;
  kind: 'file' | 'directory';
}
// Internal port throws normalized AppFault; the public service boundary returns Result<T>.
export interface FileSystemPort {
  readonly name: string;
  read(path: readonly string[]): Promise<TextFile | null>;
  list(path: readonly string[]): Promise<Entry[]>;
  ensureDirectory(path: readonly string[]): Promise<void>;
  write(path: readonly string[], text: string, expectedHash: string | null): Promise<void>;
  removeGeneratedFile(path: readonly string[], expectedHash: string): Promise<void>;
  cleanupPending(operationId: string): Promise<void>;
}
