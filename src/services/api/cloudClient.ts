import { z } from 'zod';
import {
  cloudAccessSchema,
  cloudExportSchema,
  cloudProjectSchema,
  cloudPromptSchema,
  cloudShareSchema,
  cloudSharedProjectSchema,
  cloudSpaceSchema,
  cloudVersionSchema,
  managedUserSchema,
  type PromptPatch,
} from '../../domain/cloud';

export class CloudError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function cloudErrorMessage(error: unknown) {
  if (error instanceof CloudError) {
    if (error.status === 429) return '保存过于频繁，请稍后重试。草稿仍保留在本页面。';
    if (error.status === 409)
      return '其他页面已修改这条数据。你的草稿仍在编辑器中，请复制保留后重新加载。';
    if (error.code === 'ACCOUNT_DISABLED') return '账户已停用，请联系管理员。';
    if (error.code === 'LOGIN_REQUIRED') return '登录已过期，请先复制未保存的内容，再重新登录。';
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') return '请先修改初始密码。';
    if (error.status === 422) return '已达到空间容量上限，请联系管理员。';
  }
  return '暂时无法保存或读取服务器数据，请检查网络后重试。未保存草稿仍保留在本页面。';
}
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(data === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(result);
    const code = failure.success ? failure.data.error : 'SERVICE_UNAVAILABLE';
    // Diagnostic only: status and server error code, never request path or content.
    console.warn('[api] request failed', method, response.status, code);
    throw new CloudError(response.status, code);
  }
  return schema.parse(result);
}
const ok = z.object({ ok: z.boolean() });
export const cloudClient = {
  me: () => request('/me', cloudAccessSchema),
  space: () => request('/space', cloudSpaceSchema),
  projects: () => request('/projects', z.array(cloudProjectSchema)),
  createProject: (name: string) => request('/projects', cloudProjectSchema, 'POST', { name }),
  updateProject: (id: string, patch: unknown) =>
    request(`/projects/${id}`, cloudProjectSchema, 'PATCH', patch),
  orderProjects: (revision: number, ids: string[]) =>
    request('/projects/order', ok, 'POST', { revision, ids }),
  share: (id: string) => request(`/projects/${id}/share`, cloudShareSchema),
  createShare: (id: string) => request(`/projects/${id}/share`, cloudShareSchema, 'POST', {}),
  revokeShare: (id: string) => request(`/projects/${id}/share`, ok, 'DELETE', {}),
  sharedProject: (token: string) =>
    request(`/share/${encodeURIComponent(token)}`, cloudSharedProjectSchema),
  exportData: (scope: 'project' | 'space', id?: string) =>
    request(
      `/export?scope=${scope}${id ? `&id=${encodeURIComponent(id)}` : ''}`,
      cloudExportSchema,
    ),
  prompts: (id: string) => request(`/projects/${id}/prompts`, z.array(cloudPromptSchema)),
  createPrompt: (id: string) => request(`/projects/${id}/prompts`, cloudPromptSchema, 'POST', {}),
  prompt: (id: string) => request(`/prompts/${id}`, cloudPromptSchema),
  save: (id: string, patch: PromptPatch) =>
    request(`/prompts/${id}`, cloudPromptSchema, 'PATCH', patch),
  versions: (id: string) => request(`/prompts/${id}/versions`, z.array(cloudVersionSchema)),
  split: (id: string, revision: number, from: number, to: number) =>
    request(`/prompts/${id}/split`, z.object({ id: z.string() }), 'POST', { revision, from, to }),
  order: (id: string, revision: number, ids: string[]) =>
    request(`/projects/${id}/order`, ok, 'POST', { revision, ids }),
  users: (offset: number) => request(`/admin/users?offset=${offset}`, z.array(managedUserSchema)),
  removeUser: (id: string) =>
    request(`/admin/users/${encodeURIComponent(id)}`, ok, 'DELETE', { confirmation: '删除用户' }),
  manageUser: (id: string, patch: { disabled?: boolean; password?: string }) =>
    request(`/admin/users/${encodeURIComponent(id)}`, ok, 'PATCH', patch),
};
