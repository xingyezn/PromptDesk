export interface WorkspaceLock {
  writable: boolean;
  release: () => void;
}
export async function acquireWorkspaceLock(workspaceId: string): Promise<WorkspaceLock> {
  if (typeof navigator === 'undefined' || !navigator.locks)
    return { writable: true, release: () => undefined };
  return new Promise((resolve) => {
    let release: () => void = () => undefined;
    const lifetime = new Promise<void>((done) => {
      release = done;
    });
    void navigator.locks
      .request(
        `promptdesk:workspace:${workspaceId}`,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          resolve({ writable: !!lock, release });
          if (lock) await lifetime;
        },
      )
      .catch(() => resolve({ writable: false, release: () => undefined }));
  });
}
