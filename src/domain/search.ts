import {
  statusLabels,
  statusSchema,
  type Project,
  type PromptMeta,
  type PromptStatus,
} from './schemas';
export interface SearchFilters {
  query: string;
  projectId: string;
  status: PromptStatus | '';
  target: string;
  tag: string;
  includeArchived: boolean;
}
export interface SearchDocument {
  meta: PromptMeta;
  project: Project;
  body: string;
  unavailable: boolean;
}
export function matchesSearch(document: SearchDocument, filters: SearchFilters): boolean {
  const { meta, project } = document;
  if (
    meta.deletedAt ||
    project.deletedAt ||
    (!filters.includeArchived && (meta.status === 'archived' || project.status === 'archived'))
  )
    return false;
  if (filters.projectId && project.id !== filters.projectId) return false;
  if (filters.status && meta.status !== filters.status) return false;
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
  if (filters.target && normalize(meta.target) !== normalize(filters.target)) return false;
  if (filters.tag && !meta.tags.some((tag) => normalize(tag) === normalize(filters.tag)))
    return false;
  const text = normalize([meta.title, document.body, project.name, ...meta.tags].join('\n'));
  return filters.query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(normalize(term)));
}
export function parseSearchText(query: string): {
  query: string;
  filters: { status?: PromptStatus; target?: string; tag?: string; projectName?: string };
  unknown: string[];
} {
  const terms: string[] = [],
    filters: { status?: PromptStatus; target?: string; tag?: string; projectName?: string } = {},
    unknown: string[] = [];
  for (const match of query.matchAll(/(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi)) {
    const prefix = match[1]?.toLowerCase(),
      value = match[2] ?? match[3] ?? '';
    if (!prefix) {
      terms.push(value);
      continue;
    }
    if (prefix === 'model') filters.target = value;
    else if (prefix === 'tag') filters.tag = value;
    else if (prefix === 'project') filters.projectName = value;
    else if (prefix === 'status') {
      const status = statusSchema.options.find((s) => s === value || statusLabels[s] === value);
      if (status) filters.status = status;
      else unknown.push(`status:${value}`);
    } else unknown.push(`${prefix}:${value}`);
  }
  return { query: terms.join(' '), filters, unknown };
}
