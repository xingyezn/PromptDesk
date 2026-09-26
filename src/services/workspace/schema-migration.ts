import {
  json,
  legacyProjectSchema,
  legacyPromptSchema,
  legacyScratchpadSchema,
  legacySettingsSchema,
  legacyWorkspaceSchema,
  newId,
  parseDocument,
  pendingSchema,
  projectSchema,
  promptSchema,
  scratchpadSchema,
  settingsSchema,
  workspaceSchema,
  type PromptStatus,
} from '../../domain/schemas';
import { settingsPath, workspacePath } from '../../domain/paths';
import { AppFault } from '../../types/errors';
import type { FileSystemPort } from '../../types/filesystem';
import { Journal, type Change } from '../transactions/journal';
import { listWorkspaceFiles } from './snapshot';
import { invalidPromptRelations } from '../../domain/relations';

export interface LegacyPromptChoice {
  projectId: string;
  promptId: string;
  title: string;
}
export interface MigrationPreview {
  workspaceId: string;
  workspaceName: string;
  counts: Record<
    'idea' | 'draft' | 'ready' | 'submitted' | 'waiting' | 'blocked' | 'completed',
    number
  >;
  archivedPrompts: LegacyPromptChoice[];
  sourceFingerprint: string;
}
export interface MigrationRecovery {
  workspaceId: string;
  workspaceName: string;
  operationId: string;
  phase: 'prepared' | 'committed';
}
export type LegacyMigrationState =
  | { kind: 'preview'; preview: MigrationPreview }
  | { kind: 'recovery'; recovery: MigrationRecovery };
export type ArchivedPromptChoices = Record<string, PromptStatus>;
export const archivedChoiceKey = (projectId: string, promptId: string) =>
  `${projectId}:${promptId}`;

const mapStatus = (value: string, archived: PromptStatus = 'draft'): PromptStatus => {
  if (value === 'idea' || value === 'draft') return 'draft';
  if (value === 'ready' || value === 'submitted' || value === 'waiting' || value === 'blocked')
    return 'ready';
  if (value === 'completed') return 'completed';
  if (value === 'archived') return archived;
  throw new AppFault('INVALID_SCHEMA');
};

async function legacyDocuments(fs: FileSystemPort) {
  const projectDirectories = await fs.list(['projects']);
  const scratchDirectories = await fs.list(['scratchpad']);
  const paths = await listWorkspaceFiles(fs);
  const files = new Map<string, { path: string[]; text: string; hash: string }>();
  for (const path of paths) {
    const file = await fs.read(path);
    if (!file) throw new AppFault('CONFLICT');
    files.set(path.join('/'), { path, text: file.text, hash: file.hash });
  }
  const get = (key: string) => {
    const file = files.get(key);
    if (!file) throw new AppFault('INVALID_SCHEMA');
    return file;
  };
  const workspace = parseDocument(legacyWorkspaceSchema, get('.promptdesk/workspace.json').text);
  const settings = parseDocument(legacySettingsSchema, get('.promptdesk/settings.json').text);
  if (workspace.id !== settings.workspaceId) throw new AppFault('INVALID_SCHEMA');
  const projects = [...files.values()]
    .filter((file) => file.path.at(-1) === 'project.json')
    .map((file) => ({ file, meta: parseDocument(legacyProjectSchema, file.text) }));
  const projectBySlug = new Map(projects.map(({ meta }) => [meta.slug, meta]));
  for (const entry of projectDirectories) {
    if (entry.kind !== 'directory' || !projectBySlug.has(entry.name))
      throw new AppFault('INVALID_SCHEMA');
    for (const promptEntry of await fs.list(['projects', entry.name, 'prompts'])) {
      if (promptEntry.kind !== 'directory') throw new AppFault('INVALID_SCHEMA');
      const promptRoot = `projects/${entry.name}/prompts/${promptEntry.name}`;
      if (!files.has(`${promptRoot}/meta.json`) || !files.has(`${promptRoot}/current.md`))
        throw new AppFault('INVALID_SCHEMA');
    }
  }
  const prompts = [...files.values()]
    .filter((file) => file.path.at(-1) === 'meta.json' && file.path[0] === 'projects')
    .map((file) => ({ file, meta: parseDocument(legacyPromptSchema, file.text) }));
  const scratchpads = [...files.values()]
    .filter((file) => file.path.at(-1) === 'meta.json' && file.path[0] === 'scratchpad')
    .map((file) => ({ file, meta: parseDocument(legacyScratchpadSchema, file.text) }));
  const scratchById = new Set(scratchpads.map(({ meta }) => meta.id));
  for (const entry of scratchDirectories) {
    if (entry.kind !== 'directory' || !scratchById.has(entry.name))
      throw new AppFault('INVALID_SCHEMA');
    if (
      !files.has(`scratchpad/${entry.name}/meta.json`) ||
      !files.has(`scratchpad/${entry.name}/current.md`)
    )
      throw new AppFault('INVALID_SCHEMA');
  }
  const projectIds = new Set<string>();
  for (const { file, meta } of projects) {
    if (meta.slug !== file.path[1] || projectIds.has(meta.id)) throw new AppFault('INVALID_SCHEMA');
    projectIds.add(meta.id);
  }
  for (const file of files.values()) {
    if (file.path[0] === 'projects' && file.path.length >= 3) {
      const projectKey = `projects/${file.path[1]}/project.json`;
      if (!files.has(projectKey)) throw new AppFault('INVALID_SCHEMA');
    }
  }
  const promptIds = new Set<string>();
  for (const { file, meta } of prompts) {
    const project = projectBySlug.get(file.path[1] ?? '');
    if (
      !project ||
      meta.projectId !== project.id ||
      meta.id !== file.path[3] ||
      promptIds.has(`${meta.projectId}:${meta.id}`)
    )
      throw new AppFault('INVALID_SCHEMA');
    promptIds.add(`${meta.projectId}:${meta.id}`);
    if (!files.has(`${file.path.slice(0, 4).join('/')}/current.md`))
      throw new AppFault('INVALID_SCHEMA');
    for (const version of meta.versions) {
      const versionFile = get(`${file.path.slice(0, 4).join('/')}/versions/${version.fileName}`);
      if (versionFile.hash !== version.contentHash) throw new AppFault('INVALID_SCHEMA');
    }
    const actualVersions = [...files.keys()].filter((key) =>
      key.startsWith(`${file.path.slice(0, 4).join('/')}/versions/`),
    );
    if (actualVersions.length !== meta.versions.length) throw new AppFault('INVALID_SCHEMA');
  }
  for (const { file, meta } of scratchpads) {
    if (meta.id !== file.path[1] || !files.has(`scratchpad/${meta.id}/current.md`))
      throw new AppFault('INVALID_SCHEMA');
    if (
      meta.transferredTo &&
      !prompts.some(
        ({ meta: prompt }) =>
          prompt.projectId === meta.transferredTo?.projectId &&
          prompt.id === meta.transferredTo.promptId,
      )
    )
      throw new AppFault('INVALID_SCHEMA');
  }
  if (invalidPromptRelations(prompts.map(({ meta }) => meta)).size)
    throw new AppFault('INVALID_SCHEMA');
  const sourceFingerprint = [...files.values()]
    .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')))
    .map((file) => `${file.path.join('/')}:${file.hash}`)
    .join('\n');
  return { files, workspace, settings, projects, prompts, scratchpads, sourceFingerprint };
}

export async function previewLegacyWorkspace(fs: FileSystemPort): Promise<MigrationPreview> {
  const data = await legacyDocuments(fs);
  const counts: MigrationPreview['counts'] = {
    idea: 0,
    draft: 0,
    ready: 0,
    submitted: 0,
    waiting: 0,
    blocked: 0,
    completed: 0,
  };
  const archivedPrompts: LegacyPromptChoice[] = [];
  for (const { meta } of data.prompts) {
    if (meta.status === 'archived') {
      archivedPrompts.push({ projectId: meta.projectId, promptId: meta.id, title: meta.title });
    } else if (meta.status in counts) counts[meta.status as keyof typeof counts] += 1;
  }
  return {
    workspaceId: data.workspace.id,
    workspaceName: data.workspace.name,
    counts,
    archivedPrompts,
    sourceFingerprint: data.sourceFingerprint,
  };
}

export async function inspectLegacyMigration(fs: FileSystemPort): Promise<LegacyMigrationState> {
  const root = await fs.read(workspacePath);
  if (!root) throw new AppFault('NOT_FOUND');
  const workspace = parseDocument(legacyWorkspaceSchema, root.text);
  const journal = new Journal(fs, workspace.id);
  const records = await journal.inspect();
  const migrations = records.filter((record) => record.kind === 'migration');
  if (migrations.length > 1) throw new AppFault('RECOVERY_REQUIRED');
  const record = migrations[0];
  if (record) {
    const manifest = await fs.read(['.promptdesk', 'pending', record.operationId, 'manifest.json']);
    if (!manifest) throw new AppFault('RECOVERY_REQUIRED');
    const verified = parseDocument(pendingSchema, manifest.text);
    if (verified.operationId !== record.operationId) throw new AppFault('INVALID_SCHEMA');
    return {
      kind: 'recovery',
      recovery: {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        operationId: record.operationId,
        phase: record.phase,
      },
    };
  }
  if (records.length) throw new AppFault('RECOVERY_REQUIRED');
  return { kind: 'preview', preview: await previewLegacyWorkspace(fs) };
}

export async function recoverLegacyMigration(
  fs: FileSystemPort,
  workspaceId: string,
  operationId: string,
  choice: 'finish' | 'rollback',
): Promise<void> {
  const journal = new Journal(fs, workspaceId);
  const records = await journal.inspect();
  const record = records.find(
    (item) => item.operationId === operationId && item.kind === 'migration',
  );
  if (!record) throw new AppFault('CONFLICT');
  await journal.recover(record, choice);
}

export async function migrateLegacyWorkspace(
  fs: FileSystemPort,
  choices: ArchivedPromptChoices,
  expectedFingerprint?: string,
): Promise<void> {
  const data = await legacyDocuments(fs);
  if (expectedFingerprint && data.sourceFingerprint !== expectedFingerprint)
    throw new AppFault('CONFLICT');
  const expected = new Set(
    data.prompts
      .filter(({ meta }) => meta.status === 'archived')
      .map(({ meta }) => archivedChoiceKey(meta.projectId, meta.id)),
  );
  if (
    Object.keys(choices).length !== expected.size ||
    Object.keys(choices).some((key) => !expected.has(key))
  )
    throw new AppFault('INVALID_SCHEMA');
  for (const choice of Object.values(choices))
    if (!['draft', 'ready', 'completed'].includes(choice)) throw new AppFault('INVALID_SCHEMA');
  const operationId = newId('op');
  const at = new Date().toISOString();
  const update = (value: Record<string, unknown>) => ({
    ...value,
    schemaVersion: 2,
    revision: Number(value.revision) + 1,
    lastOperationId: operationId,
    updatedAt: at,
  });
  const changes: Change[] = [];
  for (const { file, meta } of data.prompts) {
    const chosen = choices[archivedChoiceKey(meta.projectId, meta.id)] ?? 'draft';
    const nextStatus = mapStatus(meta.status, chosen);
    const statusHistory = meta.statusHistory.map((event) => ({
      ...event,
      from: event.from === null ? null : mapStatus(event.from, chosen),
      to: mapStatus(event.to, chosen),
      kind: event.kind === 'created' ? 'created' : 'transition',
    }));
    if (statusHistory.at(-1)?.to !== nextStatus) throw new AppFault('INVALID_SCHEMA');
    const next = promptSchema.parse({
      ...update(meta),
      status: nextStatus,
      priority: 'normal',
      statusHistory,
    });
    changes.push({ path: file.path, before: file.text, after: json(next) });
  }
  for (const { file, meta } of data.projects) {
    const next = projectSchema.parse(update(meta));
    changes.push({ path: file.path, before: file.text, after: json(next) });
  }
  for (const { file, meta } of data.scratchpads) {
    const next = scratchpadSchema.parse(update(meta));
    changes.push({ path: file.path, before: file.text, after: json(next) });
  }
  const settingsFile = data.files.get(settingsPath.join('/'))!;
  const settings = settingsSchema.parse(update(data.settings));
  changes.push({ path: settingsPath, before: settingsFile.text, after: json(settings) });
  const workspaceFile = data.files.get(workspacePath.join('/'))!;
  const workspace = workspaceSchema.parse(update(data.workspace));
  changes.push({ path: workspacePath, before: workspaceFile.text, after: json(workspace) });
  await new Journal(fs, workspace.id).commit(changes, 'migration', operationId);
}
