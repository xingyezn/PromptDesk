// Synthetic browser filesystem for UI integration only. This does not validate native permissions.
export function installSyntheticPicker(options?: {
  migration?: boolean;
  seedFiles?: [string, string][];
}) {
  const failureState = window as Window & {
    promptdeskSyntheticFailure?: { failCleanupOnce: boolean };
  };
  failureState.promptdeskSyntheticFailure = { failCleanupOnce: false };
  function createRoot(rootName: string, seedFiles: [string, string][] = []) {
    const files = new Map<string, string>(),
      dirs = new Set<string>(['']);
    for (const [path, text] of seedFiles) {
      files.set(path, text);
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    function notFound(): never {
      throw new DOMException('Synthetic missing entry', 'NotFoundError');
    }
    function directory(path: string): Record<string, unknown> {
      return {
        name: path.split('/').at(-1) || rootName,
        kind: 'directory',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        isSameEntry: async () => false,
        getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
          const key = path ? `${path}/${name}` : name;
          if (!dirs.has(key) && !options?.create) notFound();
          dirs.add(key);
          return directory(key);
        },
        getFileHandle: async (name: string, options?: { create?: boolean }) => {
          const key = path ? `${path}/${name}` : name;
          if (!files.has(key) && !options?.create) notFound();
          if (!files.has(key)) files.set(key, '');
          return {
            kind: 'file',
            name,
            getFile: async () => new File([files.get(key) ?? ''], name),
            createWritable: async () => {
              let content = '';
              return {
                write: async (text: string) => {
                  content = text;
                },
                close: async () => {
                  files.set(key, content);
                },
                abort: async () => undefined,
              };
            },
          };
        },
        values: async function* () {
          const prefix = path ? `${path}/` : '';
          for (const key of dirs)
            if (key.startsWith(prefix) && key !== path && !key.slice(prefix.length).includes('/'))
              yield { name: key.slice(prefix.length), kind: 'directory' };
          for (const key of files.keys())
            if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
              yield { name: key.slice(prefix.length), kind: 'file' };
        },
        removeEntry: async (name: string, options?: { recursive?: boolean }) => {
          const key = path ? `${path}/${name}` : name;
          if (
            key.startsWith('.promptdesk/pending/op_') &&
            failureState.promptdeskSyntheticFailure?.failCleanupOnce
          ) {
            failureState.promptdeskSyntheticFailure.failCleanupOnce = false;
            throw new DOMException('Synthetic cleanup failure', 'NotAllowedError');
          }
          files.delete(key);
          dirs.delete(key);
          if (options?.recursive) {
            for (const file of files.keys()) if (file.startsWith(`${key}/`)) files.delete(file);
            for (const dir of dirs) if (dir.startsWith(`${key}/`)) dirs.delete(dir);
          }
        },
      };
    }
    return directory('');
  }
  const source = createRoot('Synthetic Workspace', options?.seedFiles),
    target = createRoot('Synthetic Destination');
  let picks = 0;
  Object.defineProperty(window, 'showDirectoryPicker', {
    value: async () => (picks++ === 0 || options?.migration === false ? source : target),
    configurable: true,
  });
}
