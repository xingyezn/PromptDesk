import { AppFault } from '../types/errors';

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function validatePath(path: readonly string[], allowRoot = false): void {
  if (!allowRoot && !path.length) throw new AppFault('PATH_INVALID');
  for (const segment of path) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      /[\\/:*?"<>|]/.test(segment) ||
      [...segment].some((c) => c.charCodeAt(0) < 32) ||
      /[. ]$/.test(segment) ||
      reserved.test(segment)
    )
      throw new AppFault('PATH_INVALID');
  }
}
export function isBusinessPath(path: readonly string[]): boolean {
  validatePath(path);
  const joined = path.join('/');
  return (
    /^\.promptdesk\/(workspace|settings)\.json$/.test(joined) ||
    /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/(project\.json|README\.md)$/.test(joined) ||
    /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/prompts\/P\d{3,}\/(meta\.json|current\.md|result\.md|versions\/v\d{3,}\.md)$/.test(
      joined,
    ) ||
    /^scratchpad\/scratch_[0-9a-f-]+\/(meta\.json|current\.md)$/.test(joined)
  );
}
export const workspacePath = ['.promptdesk', 'workspace.json'];
export const settingsPath = ['.promptdesk', 'settings.json'];
export const versionFile = (number: number) => `v${String(number).padStart(3, '0')}.md`;
export const promptPath = (slug: string, id: string) => ['projects', slug, 'prompts', id];
