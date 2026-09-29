import type { CloudExport } from './cloud';

export function archiveSegment(value: string, fallback: string): string {
  const cleaned = Array.from(value)
    .map((character) =>
      character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? ' ' : character,
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
  return (cleaned || fallback).slice(0, 60);
}

// Builds a readable, portable backup tree: one folder per project with a manifest and
// numbered prompt files plus immutable version snapshots. Pure function, safe to unit test.
export function cloudArchiveFiles(data: CloudExport): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  data.projects.forEach(({ project, prompts }, projectIndex) => {
    const dir = `PromptDesk/${String(projectIndex + 1).padStart(2, '0')}-${archiveSegment(project.name, 'project')}`;
    const promptNames = prompts.map(
      (entry, index) =>
        `${String(index + 1).padStart(2, '0')}-${archiveSegment(entry.prompt.title, 'prompt')}`,
    );
    files.push({
      path: `${dir}/manifest.json`,
      content: JSON.stringify(
        {
          name: project.name,
          description: project.description,
          archived: Boolean(project.archived),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          prompts: prompts.map((entry, index) => ({
            order: index + 1,
            title: entry.prompt.title,
            status: entry.prompt.status,
            priority: entry.prompt.priority,
            file: `${promptNames[index]}.md`,
            versions: entry.versions.map((version) => version.number),
          })),
        },
        null,
        2,
      ),
    });
    prompts.forEach((entry, index) => {
      files.push({ path: `${dir}/${promptNames[index]}.md`, content: entry.prompt.body });
      for (const version of entry.versions)
        files.push({
          path: `${dir}/versions/${promptNames[index]}-v${String(version.number).padStart(3, '0')}.md`,
          content: version.body,
        });
    });
  });
  return files;
}
