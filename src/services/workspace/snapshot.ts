import { isBusinessPath, validatePath, workspacePath } from '../../domain/paths';
import {
  parseDocument,
  projectSchema,
  promptSchema,
  scratchpadSchema,
  settingsSchema,
  workspaceSchema,
} from '../../domain/schemas';
import type { FileSystemPort } from '../../types/filesystem';
import { AppFault } from '../../types/errors';
import { Journal } from '../transactions/journal';
import { invalidPromptRelations } from '../../domain/relations';
import type { PromptMeta } from '../../domain/schemas';

export interface WorkspaceFile {
  path: string[];
  text: string;
  hash: string;
  size: number;
}
export interface WorkspaceSnapshot {
  files: WorkspaceFile[];
  totalBytes: number;
  workspaceId: string;
}
const maxBytes = 32 * 1024 * 1024;
const maxFiles = 5000;

// Only descend into application-owned paths. Unknown entries inside them block transfer,
// rather than producing a backup that silently omits part of a workspace.
export async function listWorkspaceFiles(fs: FileSystemPort): Promise<string[][]> {
  const paths: string[][] = [];
  const directoryAllowed = (path: string[]) => {
    const key = path.join('/');
    return (
      /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/prompts(?:\/P\d{3,}(?:\/versions)?)?)?$/.test(key) ||
      /^scratchpad\/scratch_[0-9a-f-]{36}$/.test(key)
    );
  };
  let entriesSeen = 0;
  async function visit(path: string[]) {
    for (const entry of await fs.list(path)) {
      if (++entriesSeen > maxFiles * 2) throw new AppFault('TRANSFER_LIMIT');
      const child = [...path, entry.name];
      validatePath(child);
      if (child.join('/') === '.promptdesk/pending' && entry.kind === 'directory') {
        if ((await fs.list(child)).length) throw new AppFault('RECOVERY_REQUIRED');
        continue;
      }
      if (entry.kind === 'directory' && directoryAllowed(child)) await visit(child);
      else if (entry.kind === 'file' && isBusinessPath(child)) paths.push(child);
      else throw new AppFault('UNRECOGNIZED_FILES');
      if (paths.length > maxFiles) throw new AppFault('TRANSFER_LIMIT');
    }
  }
  for (const root of ['.promptdesk', 'projects', 'scratchpad']) await visit([root]);
  return paths.sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

export async function captureSnapshot(fs: FileSystemPort): Promise<WorkspaceSnapshot> {
  const files: WorkspaceFile[] = [];
  let totalBytes = 0;
  for (const path of await listWorkspaceFiles(fs)) {
    const file = await fs.read(path);
    if (!file) throw new AppFault('CONFLICT');
    totalBytes += file.size;
    if (totalBytes > maxBytes) throw new AppFault('TRANSFER_LIMIT');
    files.push({ path, text: file.text, hash: file.hash, size: file.size });
  }
  const byPath = new Map(files.map((file) => [file.path.join('/'), file]));
  const required = (path: string) => {
    const file = byPath.get(path);
    if (!file) throw new AppFault('INVALID_SCHEMA');
    return file;
  };
  const workspace = parseDocument(workspaceSchema, required('.promptdesk/workspace.json').text);
  const settings = parseDocument(settingsSchema, required('.promptdesk/settings.json').text);
  if (workspace.id !== settings.workspaceId) throw new AppFault('INVALID_SCHEMA');
  const projectIds = new Set<string>();
  const prompts: PromptMeta[] = [];
  for (const file of files.filter((f) => f.path.at(-1) === 'project.json')) {
    const project = parseDocument(projectSchema, file.text);
    if (project.slug !== file.path[1] || projectIds.has(project.id))
      throw new AppFault('INVALID_SCHEMA');
    projectIds.add(project.id);
  }
  for (const file of files.filter((f) => f.path.at(-1) === 'meta.json')) {
    const parent = file.path.slice(0, -1).join('/');
    required(`${parent}/current.md`);
    if (file.path[0] === 'scratchpad') {
      const scratch = parseDocument(scratchpadSchema, file.text);
      if (scratch.id !== file.path[1]) throw new AppFault('INVALID_SCHEMA');
      if (scratch.transferredTo) {
        const ref = scratch.transferredTo;
        const target = files.find(
          (entry) =>
            entry.path.at(-1) === 'meta.json' &&
            entry.path[0] === 'projects' &&
            entry.path[3] === ref.promptId &&
            parseDocument(promptSchema, entry.text).projectId === ref.projectId,
        );
        if (!target) throw new AppFault('INVALID_SCHEMA');
      }
    } else {
      const meta = parseDocument(promptSchema, file.text);
      prompts.push(meta);
      const project = parseDocument(
        projectSchema,
        required(`projects/${file.path[1]}/project.json`).text,
      );
      if (meta.projectId !== project.id || meta.id !== file.path[3])
        throw new AppFault('INVALID_SCHEMA');
      for (const version of meta.versions)
        if (required(`${parent}/versions/${version.fileName}`).hash !== version.contentHash)
          throw new AppFault('INVALID_SCHEMA');
      const actual = files.filter(
        (entry) => entry.path.slice(0, -1).join('/') === `${parent}/versions`,
      );
      if (actual.length !== meta.versions.length) throw new AppFault('INVALID_SCHEMA');
    }
  }
  if (invalidPromptRelations(prompts).size) throw new AppFault('INVALID_SCHEMA');
  // Reject orphan content; never call an incomplete directory a complete backup.
  for (const file of files) {
    if (file.path[0] === 'projects') {
      required(`projects/${file.path[1]}/project.json`);
      if (file.path[2] === 'prompts') required(`${file.path.slice(0, 4).join('/')}/meta.json`);
    }
    if (file.path[0] === 'scratchpad') required(`${file.path.slice(0, 2).join('/')}/meta.json`);
  }
  const snapshot = { files, totalBytes, workspaceId: workspace.id };
  await verifySnapshot(fs, snapshot);
  return snapshot;
}

export async function verifySnapshot(fs: FileSystemPort, snapshot: WorkspaceSnapshot) {
  const paths = await listWorkspaceFiles(fs);
  if (JSON.stringify(paths) !== JSON.stringify(snapshot.files.map((f) => f.path)))
    throw new AppFault('CONFLICT');
  for (const file of snapshot.files)
    if ((await fs.read(file.path))?.hash !== file.hash) throw new AppFault('CONFLICT');
}

export async function copySnapshot(
  source: FileSystemPort,
  target: FileSystemPort,
  snapshot: WorkspaceSnapshot,
) {
  if ((await target.list([])).length) throw new AppFault('DESTINATION_NOT_EMPTY');
  await verifySnapshot(source, snapshot);
  const ordered = [
    ...snapshot.files.filter((f) => f.path.join('/') !== workspacePath.join('/')),
    snapshot.files.find((f) => f.path.join('/') === workspacePath.join('/'))!,
  ];
  // Initialization journals already support reopening before the root marker exists.
  const journal = new Journal(target, snapshot.workspaceId);
  await journal.exclusive(() =>
    journal.commit(
      ordered.map((f) => ({ path: f.path, before: null, after: f.text })),
      'initialize',
    ),
  );
  if ((await target.list(['.promptdesk', 'pending'])).length)
    throw new AppFault('RECOVERY_REQUIRED');
  await verifySnapshot(target, snapshot);
  await verifySnapshot(source, snapshot);
}
