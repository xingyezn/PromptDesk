import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { cloudProjectSchema, cloudPromptSchema, cloudVersionSchema } from '../../src/domain/cloud';
import { z } from 'zod';

const origin = 'https://promptdesk-preview.openedutools.workers.dev';
let syntheticAddress = 0;
async function call(
  path: string,
  cookie = '',
  method = 'GET',
  body?: unknown,
  requestOrigin = origin,
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${origin}/api${path}`, {
      method,
      headers: {
        cookie,
        origin: requestOrigin,
        'cf-connecting-ip': `192.0.2.${++syntheticAddress}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
async function user() {
  const response = await call('/auth/sign-up/email', '', 'POST', {
    name: 'Synthetic Cloud User',
    email: `cloud-${crypto.randomUUID()}@example.test`,
    password: 'synthetic-cloud-password-12',
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toBeTruthy();
  const data = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json());
  return { cookie: cookie!, id: data.user.id };
}
async function project(cookie: string) {
  return cloudProjectSchema.parse(
    await (await call('/projects', cookie, 'POST', { name: 'Synthetic project' })).json(),
  );
}
async function prompt(cookie: string, id: string) {
  return cloudPromptSchema.parse(
    await (await call(`/projects/${id}/prompts`, cookie, 'POST', {})).json(),
  );
}

describe('Cloud personal spaces', () => {
  it('isolates projects, prompts and versions by server session and rejects forged ownership and origin', async () => {
    const a = await user(),
      b = await user(),
      p = await project(a.cookie),
      item = await prompt(a.cookie, p.id);
    expect((await call('/projects')).status).toBe(401);
    expect(await (await call('/projects', b.cookie)).json()).toEqual([]);
    for (const path of [
      `/projects/${p.id}/prompts`,
      `/prompts/${item.id}`,
      `/prompts/${item.id}/versions`,
    ])
      expect((await call(path, b.cookie)).status).toBe(404);
    expect(
      (await call(`/prompts/${item.id}`, b.cookie, 'PATCH', { revision: 1, body: 'forged' }))
        .status,
    ).toBe(404);
    expect(
      (await call('/projects', a.cookie, 'POST', { name: 'Synthetic', ownerId: b.id })).status,
    ).toBe(400);
    expect(
      (
        await call(
          '/projects',
          a.cookie,
          'POST',
          { name: 'Synthetic' },
          'https://untrusted.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/auth/sign-up/email/', '', 'POST', {
          name: 'Synthetic reserved account',
          email: 'admin@prompt.com',
          password: 'synthetic-admin-password-12',
        })
      ).status,
    ).toBe(403);
    expect((await call('/admin/users', a.cookie)).status).toBe(403);
    expect(
      (
        await call('/auth/sign-up/email', '', 'POST', {
          name: 'Synthetic admin',
          email: 'admin@promptdesk.local',
          password: 'synthetic-admin-password-12',
        })
      ).status,
    ).toBe(403);
  });
  it('saves drafts without versions, checkpoints atomically, rejects stale saves and preserves draft on restore', async () => {
    const a = await user(),
      p = await project(a.cookie),
      item = await prompt(a.cookie, p.id);
    const save = async (revision: number, patch: unknown) =>
      call(`/prompts/${item.id}`, a.cookie, 'PATCH', {
        revision,
        ...z.record(z.string(), z.unknown()).parse(patch),
      });
    expect((await save(1, { body: 'Synthetic first draft' })).status).toBe(200);
    expect(await (await call(`/prompts/${item.id}/versions`, a.cookie)).json()).toEqual([]);
    expect((await save(2, { status: 'ready' })).status).toBe(200);
    expect((await save(2, { body: 'Stale content', checkpoint: true })).status).toBe(409);
    expect((await save(3, { body: 'Synthetic next draft' })).status).toBe(200);
    expect((await save(4, { restoreVersion: 1 })).status).toBe(200);
    const history = z
      .array(cloudVersionSchema)
      .parse(await (await call(`/prompts/${item.id}/versions`, a.cookie)).json());
    expect(history.map((v) => [v.number, v.body])).toEqual([
      [3, 'Synthetic first draft'],
      [2, 'Synthetic next draft'],
      [1, 'Synthetic first draft'],
    ]);
    const latest = cloudPromptSchema.parse(
      await (await call(`/prompts/${item.id}`, a.cookie)).json(),
    );
    expect(latest.status).toBe('ready');
    expect(latest.revision).toBe(5);
    await expect(
      env.DB.prepare('UPDATE cloud_version SET body=? WHERE id=?')
        .bind('bad', history[0]!.id)
        .run(),
    ).rejects.toThrow();
    // A failing storage constraint rolls back both the body and checkpoint in the D1 batch.
    await env.DB.prepare('UPDATE cloud_usage SET bytes=10485760 WHERE userId=?').bind(a.id).run();
    expect(
      (
        await save(5, {
          body: 'Synthetic larger draft that exceeds storage quota',
          checkpoint: true,
        })
      ).status,
    ).toBe(503);
    expect(
      cloudPromptSchema.parse(await (await call(`/prompts/${item.id}`, a.cookie)).json()).revision,
    ).toBe(5);
    expect(
      z
        .array(cloudVersionSchema)
        .parse(await (await call(`/prompts/${item.id}/versions`, a.cookie)).json()),
    ).toHaveLength(3);
  });
  it('splits, reorders, completes and soft-deletes with revision and read-only protection', async () => {
    const a = await user(),
      p = await project(a.cookie),
      one = await prompt(a.cookie, p.id);
    await call(`/prompts/${one.id}`, a.cookie, 'PATCH', { revision: 1, body: 'First\nSecond' });
    const split = await call(`/prompts/${one.id}/split`, a.cookie, 'POST', {
      revision: 2,
      from: 6,
      to: 12,
    });
    expect(split.status).toBe(201);
    const two = z.object({ id: z.string() }).parse(await split.json());
    expect(
      (
        await call(`/projects/${p.id}/order`, a.cookie, 'POST', {
          revision: 1,
          ids: [two.id, one.id],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/projects/${p.id}/order`, a.cookie, 'POST', {
          revision: 1,
          ids: [one.id, two.id],
        })
      ).status,
    ).toBe(409);
    const rows = z
      .array(cloudPromptSchema)
      .parse(await (await call(`/projects/${p.id}/prompts`, a.cookie)).json());
    expect(rows.map((x) => x.id)).toEqual([two.id, one.id]);
    expect(rows.map((x) => x.body)).toEqual(['Second', 'First\n']);
    await call(`/prompts/${two.id}`, a.cookie, 'PATCH', { revision: 1, status: 'completed' });
    await call(`/prompts/${two.id}`, a.cookie, 'PATCH', { revision: 2, deleted: true });
    expect(
      (await call(`/prompts/${two.id}`, a.cookie, 'PATCH', { revision: 3, body: 'bad' })).status,
    ).toBe(403);
    expect(
      (await call(`/prompts/${two.id}`, a.cookie, 'PATCH', { revision: 3, deleted: false })).status,
    ).toBe(200);
    await call(`/projects/${p.id}`, a.cookie, 'PATCH', { revision: 2, archived: true });
    expect(
      (await call(`/prompts/${one.id}`, a.cookie, 'PATCH', { revision: 3, body: 'bad' })).status,
    ).toBe(403);
  });
  it('requires initial password change and revokes all sessions for suspended users', async () => {
    const admin = await user(),
      member = await user();
    const memberProject = await project(member.cookie);
    await prompt(member.cookie, memberProject.id);
    await env.DB.prepare("UPDATE user_access SET role='admin',mustChangePassword=1 WHERE userId=?")
      .bind(admin.id)
      .run();
    expect((await call('/admin/users', admin.cookie)).status).toBe(403);
    const changed = await call('/auth/change-password', admin.cookie, 'POST', {
      currentPassword: 'synthetic-cloud-password-12',
      newPassword: 'synthetic-replaced-password-12',
      revokeOtherSessions: true,
    });
    expect(changed.status).toBe(200);
    admin.cookie = changed.headers.get('set-cookie')?.split(';')[0] ?? admin.cookie;
    expect((await call('/admin/users', admin.cookie)).status).toBe(200);
    expect(
      (await call(`/admin/users/${admin.id}`, admin.cookie, 'PATCH', { disabled: true })).status,
    ).toBe(400);
    expect(
      (await call(`/admin/users/${member.id}`, admin.cookie, 'PATCH', { disabled: true })).status,
    ).toBe(200);
    expect((await call('/projects', member.cookie)).status).toBe(401);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?')
        .bind(member.id)
        .first(),
    ).toMatchObject({ n: 0 });
    expect(
      (
        await call(`/admin/users/${member.id}`, admin.cookie, 'PATCH', {
          disabled: false,
          password: 'synthetic-reset-password-12',
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare('SELECT disabled,mustChangePassword FROM user_access WHERE userId=?')
        .bind(member.id)
        .first(),
    ).toMatchObject({ disabled: 0, mustChangePassword: 1 });
    expect(
      (
        await call('/auth/delete-user', admin.cookie, 'POST', {
          password: 'synthetic-replaced-password-12',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`/admin/users/${admin.id}`, admin.cookie, 'DELETE', { confirmation: '删除用户' }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(`/admin/users/${member.id}`, admin.cookie, 'DELETE', {
          confirmation: '删除用户',
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_project WHERE ownerId=?')
        .bind(member.id)
        .first(),
    ).toMatchObject({ n: 0 });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_prompt WHERE ownerId=?')
        .bind(member.id)
        .first(),
    ).toMatchObject({ n: 0 });
  });
});
