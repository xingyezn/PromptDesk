import type { PromptMeta } from './schemas';
export function invalidPromptRelations(
  prompts: readonly PromptMeta[],
  incompleteProjectIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const invalid = new Set<string>();
  const key = (prompt: PromptMeta) => `${prompt.projectId}:${prompt.id}`;
  const byKey = new Map(prompts.map((prompt) => [key(prompt), prompt]));
  for (const prompt of prompts) {
    const visited = new Set<string>();
    let current: PromptMeta | undefined = prompt;
    while (current?.parentPromptId) {
      const currentKey = key(current);
      if (visited.has(currentKey)) {
        invalid.add(key(prompt));
        break;
      }
      visited.add(currentKey);
      current = byKey.get(`${current.projectId}:${current.parentPromptId}`);
      if (!current) invalid.add(key(prompt));
    }
  }
  for (const projectId of new Set(prompts.map((p) => p.projectId))) {
    // A missing/broken metadata file already explains gaps; don't label healthy siblings corrupt.
    if (incompleteProjectIds.has(projectId)) continue;
    const active = prompts
      .filter((p) => p.projectId === projectId && !p.deletedAt)
      .sort((a, b) => a.order - b.order);
    active.forEach((prompt, i) => {
      if (prompt.order !== i + 1) invalid.add(key(prompt));
    });
  }
  return invalid;
}
