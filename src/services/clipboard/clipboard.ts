import { AppFault, attempt } from '../../types/errors';
export function copyText(body: string) {
  return attempt(async () => {
    if (!navigator.clipboard?.writeText) throw new AppFault('UNSUPPORTED');
    await navigator.clipboard.writeText(body);
  });
}
