import { z } from 'zod';
import { hashPassword } from 'better-auth/crypto';
import { createAuth } from './auth';
import type { WorkerEnvironment } from './index';
import {
  CLOUD_PROMPT_DEFAULT_BODY,
  cloudId,
  cloudOrderInput,
  projectInput,
  projectPatch,
  promptPatch,
  type CloudAccess,
  type CloudExportProject,
  type CloudProject,
  type CloudPrompt,
  type CloudVersion,
} from '../src/domain/cloud';

const headers = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
export const cloudJson = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
class ApiFault extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const projectFields =
  'id,name,description,color,sortOrder,revision,archived,deletedAt,createdAt,updatedAt';
const promptFields =
  'id,projectId,title,body,status,priority,sortOrder,revision,nextVersion,deletedAt,createdAt,updatedAt';

async function ensureSpace(db: WorkerEnvironment['DB'], owner: string): Promise<number> {
  await db
    .prepare(
      'INSERT INTO cloud_space(ownerId,revision,updatedAt) VALUES(?,1,?) ON CONFLICT(ownerId) DO NOTHING',
    )
    .bind(owner, new Date().toISOString())
    .run();
  const row = await db
    .prepare('SELECT revision FROM cloud_space WHERE ownerId=?')
    .bind(owner)
    .first<{ revision: number }>();
  return row?.revision ?? 1;
}

async function orderProjects(
  db: WorkerEnvironment['DB'],
  owner: string,
  data: { revision: number; ids: string[] },
) {
  const current = (
    await db
      .prepare('SELECT id FROM cloud_project WHERE ownerId=? AND deletedAt IS NULL')
      .bind(owner)
      .all<{ id: string }>()
  ).results;
  if (
    new Set(data.ids).size !== data.ids.length ||
    current.length !== data.ids.length ||
    current.some((row) => !data.ids.includes(row.id))
  )
    throw new ApiFault(400, 'INVALID_ORDER');
  const token = crypto.randomUUID(),
    now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        'INSERT INTO cloud_space(ownerId,revision,operation,updatedAt) VALUES(?,2,?,?) ON CONFLICT(ownerId) DO UPDATE SET revision=revision+1,operation=excluded.operation,updatedAt=excluded.updatedAt WHERE cloud_space.revision=?',
      )
      .bind(owner, token, now, data.revision),
    ...data.ids.map((id, index) =>
      db
        .prepare(
          'UPDATE cloud_project SET sortOrder=? WHERE id=? AND ownerId=? AND deletedAt IS NULL AND EXISTS(SELECT 1 FROM cloud_space WHERE ownerId=? AND operation=?)',
        )
        .bind(index, id, owner, owner, token),
    ),
  ];
  const results = await db.batch(statements);
  if (!results[0]?.meta.changes) throw new ApiFault(409, 'REVISION_CONFLICT');
}

async function input(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiFault(415, 'JSON_REQUIRED');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiFault(400, 'INVALID_REQUEST');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 512000) {
      await reader.cancel();
      throw new ApiFault(413, 'REQUEST_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    throw new ApiFault(400, 'INVALID_REQUEST');
  }
}

export async function getAccess(env: WorkerEnvironment, userId: string) {
  return env.DB.prepare('SELECT role,disabled,mustChangePassword FROM user_access WHERE userId=?')
    .bind(userId)
    .first<CloudAccess>();
}

// Unguessable URL-safe capability token for a read-only project share link.
function shareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function handleCloud(request: Request, env: WorkerEnvironment): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname;
    if (request.method !== 'GET' && request.headers.get('origin') !== env.APP_BASE_URL)
      throw new ApiFault(403, 'ORIGIN_REJECTED');
    const session = await createAuth(env).api.getSession({ headers: request.headers });
    if (!session) throw new ApiFault(401, 'LOGIN_REQUIRED');
    const owner = session.user.id,
      access = await getAccess(env, owner);
    if (!access || access.disabled) throw new ApiFault(403, 'ACCOUNT_DISABLED');
    if (path === '/api/me' && request.method === 'GET') return cloudJson(access);
    if (access.mustChangePassword) throw new ApiFault(403, 'PASSWORD_CHANGE_REQUIRED');
    if (request.method !== 'GET') {
      const bucket = Math.floor(Date.now() / 600000);
      const accepted = await env.DB.prepare(
        'INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<>excluded.lastRequest THEN 1 ELSE count+1 END,lastRequest=excluded.lastRequest WHERE lastRequest<>excluded.lastRequest OR count<300 RETURNING count',
      )
        .bind(crypto.randomUUID(), `cloud-write:${owner}`, bucket)
        .first();
      if (!accepted) throw new ApiFault(429, 'RATE_LIMITED');
    }
    if (path.startsWith('/api/admin/')) {
      if (access.role !== 'admin') throw new ApiFault(403, 'ADMIN_REQUIRED');
      return await handleAdmin(request, env, owner, url);
    }
    const db = env.DB;
    if (path === '/api/space' && request.method === 'GET') {
      const revision = await ensureSpace(db, owner);
      const projects = (
        await db
          .prepare(
            `SELECT ${projectFields} FROM cloud_project WHERE ownerId=? ORDER BY sortOrder, createdAt DESC LIMIT 50`,
          )
          .bind(owner)
          .all()
      ).results;
      return cloudJson({ revision, projects });
    }
    if (path === '/api/export' && request.method === 'GET') {
      const scope = url.searchParams.get('scope');
      if (scope !== 'project' && scope !== 'space') throw new ApiFault(400, 'INVALID_REQUEST');
      const projectId = scope === 'project' ? cloudId.parse(url.searchParams.get('id')) : null;
      const projectRows = (
        await db
          .prepare(
            scope === 'project'
              ? `SELECT ${projectFields} FROM cloud_project WHERE ownerId=? AND deletedAt IS NULL AND id=?`
              : `SELECT ${projectFields} FROM cloud_project WHERE ownerId=? AND deletedAt IS NULL ORDER BY sortOrder, createdAt DESC LIMIT 50`,
          )
          .bind(...(scope === 'project' ? [owner, projectId] : [owner]))
          .all<CloudProject>()
      ).results;
      if (!projectRows.length) throw new ApiFault(404, 'NOT_FOUND');
      const promptRows = (
        await db
          .prepare(
            `SELECT ${promptFields} FROM cloud_prompt WHERE ownerId=? AND deletedAt IS NULL ORDER BY sortOrder, createdAt LIMIT 500`,
          )
          .bind(owner)
          .all<CloudPrompt>()
      ).results;
      const versionRows = (
        await db
          .prepare(
            'SELECT id,promptId,number,body,createdAt FROM cloud_version WHERE ownerId=? ORDER BY promptId, number',
          )
          .bind(owner)
          .all<CloudVersion>()
      ).results;
      const projects: CloudExportProject[] = projectRows.map((project) => ({
        project,
        prompts: promptRows
          .filter((prompt) => prompt.projectId === project.id)
          .map((prompt) => ({
            prompt,
            versions: versionRows.filter((version) => version.promptId === prompt.id),
          })),
      }));
      return cloudJson({ projects });
    }
    if (path === '/api/projects/order' && request.method === 'POST') {
      await orderProjects(db, owner, cloudOrderInput.parse(await input(request)));
      return cloudJson({ ok: true });
    }
    if (path === '/api/projects') {
      if (request.method === 'GET')
        return cloudJson(
          (
            await db
              .prepare(
                `SELECT ${projectFields} FROM cloud_project WHERE ownerId=? AND deletedAt IS NULL ORDER BY sortOrder, createdAt DESC LIMIT 50`,
              )
              .bind(owner)
              .all()
          ).results,
        );
      if (request.method === 'POST') {
        const data = projectInput.parse(await input(request)),
          id = crypto.randomUUID(),
          now = new Date().toISOString();
        const r = await db
          .prepare(
            'INSERT INTO cloud_project(id,ownerId,name,description,color,sortOrder,createdAt,updatedAt) SELECT ?,?,?,?,?,COALESCE((SELECT MIN(sortOrder)-1 FROM cloud_project WHERE ownerId=?),0),?,? WHERE (SELECT COUNT(*) FROM cloud_project WHERE ownerId=?)<50',
          )
          .bind(id, owner, data.name, data.description, 'green', owner, now, now, owner)
          .run();
        if (!r.meta.changes) throw new ApiFault(422, 'PROJECT_LIMIT');
        return cloudJson(
          await db
            .prepare(`SELECT ${projectFields} FROM cloud_project WHERE id=? AND ownerId=?`)
            .bind(id, owner)
            .first(),
          201,
        );
      }
    }
    const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(prompts|order|share))?$/.exec(path);
    if (projectMatch) {
      const id = cloudId.parse(projectMatch[1]);
      const project = await db
        .prepare(`SELECT ${projectFields} FROM cloud_project WHERE id=? AND ownerId=?`)
        .bind(id, owner)
        .first<CloudProject>();
      if (!project) throw new ApiFault(404, 'NOT_FOUND');
      const action = projectMatch[2];
      if (action === 'share') {
        const share = await db
          .prepare(
            'SELECT token,createdAt,revokedAt FROM cloud_share WHERE projectId=? AND ownerId=?',
          )
          .bind(id, owner)
          .first<{ token: string; createdAt: string; revokedAt: string | null }>();
        if (request.method === 'GET')
          return cloudJson(
            share
              ? {
                  active: !share.revokedAt,
                  token: share.revokedAt ? null : share.token,
                  createdAt: share.createdAt,
                  revokedAt: share.revokedAt,
                }
              : { active: false, token: null, createdAt: null, revokedAt: null },
          );
        if (request.method === 'POST') {
          if (project.deletedAt) throw new ApiFault(403, 'PROJECT_READ_ONLY');
          if (share && !share.revokedAt)
            return cloudJson({
              active: true,
              token: share.token,
              createdAt: share.createdAt,
              revokedAt: null,
            });
          const token = shareToken(),
            now = new Date().toISOString();
          await db
            .prepare(
              'INSERT INTO cloud_share(id,ownerId,projectId,token,createdAt,revokedAt) VALUES(?,?,?,?,?,NULL) ON CONFLICT(projectId) DO UPDATE SET token=excluded.token,createdAt=excluded.createdAt,revokedAt=NULL',
            )
            .bind(crypto.randomUUID(), owner, id, token, now)
            .run();
          return cloudJson({ active: true, token, createdAt: now, revokedAt: null }, 201);
        }
        if (request.method === 'DELETE') {
          await db
            .prepare(
              'UPDATE cloud_share SET revokedAt=? WHERE projectId=? AND ownerId=? AND revokedAt IS NULL',
            )
            .bind(new Date().toISOString(), id, owner)
            .run();
          return cloudJson({ ok: true });
        }
      }
      if (!action && request.method === 'PATCH') {
        const data = projectPatch.parse(await input(request));
        const r = await db
          .prepare(
            'UPDATE cloud_project SET name=?,description=?,color=?,archived=?,deletedAt=?,revision=revision+1,updatedAt=? WHERE id=? AND ownerId=? AND revision=?',
          )
          .bind(
            data.name ?? project.name,
            data.description ?? project.description,
            data.color ?? project.color,
            data.archived === undefined ? project.archived : Number(data.archived),
            data.deleted === undefined
              ? project.deletedAt
              : data.deleted
                ? new Date().toISOString()
                : null,
            new Date().toISOString(),
            id,
            owner,
            data.revision,
          )
          .run();
        if (!r.meta.changes) throw new ApiFault(409, 'REVISION_CONFLICT');
        return cloudJson(
          await db
            .prepare(`SELECT ${projectFields} FROM cloud_project WHERE id=? AND ownerId=?`)
            .bind(id, owner)
            .first(),
        );
      }
      if (action === 'prompts' && request.method === 'GET')
        return cloudJson(
          (
            await db
              .prepare(
                `SELECT ${promptFields} FROM cloud_prompt WHERE projectId=? AND ownerId=? ORDER BY sortOrder,id LIMIT 500`,
              )
              .bind(id, owner)
              .all()
          ).results,
        );
      if (project.archived || project.deletedAt) throw new ApiFault(403, 'PROJECT_READ_ONLY');
      if (action === 'prompts' && request.method === 'POST') {
        const promptId = crypto.randomUUID(),
          now = new Date().toISOString();
        const r = await db
          .prepare(
            `INSERT INTO cloud_prompt(id,projectId,ownerId,body,sortOrder,createdAt,updatedAt) SELECT ?,?,?,?,COALESCE((SELECT MAX(sortOrder)+1 FROM cloud_prompt WHERE projectId=? AND ownerId=?),0),?,? WHERE (SELECT COUNT(*) FROM cloud_prompt WHERE ownerId=?)<500 AND EXISTS(SELECT 1 FROM cloud_project WHERE id=? AND ownerId=? AND archived=0 AND deletedAt IS NULL)`,
          )
          .bind(
            promptId,
            id,
            owner,
            CLOUD_PROMPT_DEFAULT_BODY,
            id,
            owner,
            now,
            now,
            owner,
            id,
            owner,
          )
          .run();
        if (!r.meta.changes) throw new ApiFault(422, 'PROMPT_LIMIT');
        return cloudJson(
          await db
            .prepare(`SELECT ${promptFields} FROM cloud_prompt WHERE id=? AND ownerId=?`)
            .bind(promptId, owner)
            .first(),
          201,
        );
      }
      if (action === 'order' && request.method === 'POST') {
        const data = z
          .object({ revision: z.number().int().positive(), ids: z.array(cloudId).max(500) })
          .strict()
          .parse(await input(request));
        const current = (
          await db
            .prepare('SELECT id FROM cloud_prompt WHERE projectId=? AND ownerId=?')
            .bind(id, owner)
            .all<{ id: string }>()
        ).results;
        if (
          new Set(data.ids).size !== data.ids.length ||
          current.length !== data.ids.length ||
          current.some((p) => !data.ids.includes(p.id))
        )
          throw new ApiFault(400, 'INVALID_ORDER');
        const token = crypto.randomUUID();
        const statements = [
          db
            .prepare(
              'UPDATE cloud_project SET revision=revision+1,operation=? WHERE id=? AND ownerId=? AND revision=? AND archived=0 AND deletedAt IS NULL',
            )
            .bind(token, id, owner, data.revision),
          ...data.ids.map((pid, index) =>
            db
              .prepare(
                'UPDATE cloud_prompt SET sortOrder=? WHERE id=? AND ownerId=? AND projectId=? AND EXISTS(SELECT 1 FROM cloud_project WHERE id=? AND ownerId=? AND operation=?)',
              )
              .bind(index, pid, owner, id, id, owner, token),
          ),
        ];
        const results = await db.batch(statements);
        if (!results[0]?.meta.changes) throw new ApiFault(409, 'REVISION_CONFLICT');
        return cloudJson({ ok: true });
      }
    }
    const promptMatch = /^\/api\/prompts\/([^/]+)(?:\/(versions|split))?$/.exec(path);
    if (promptMatch) {
      const id = cloudId.parse(promptMatch[1]);
      const prompt = await db
        .prepare(`SELECT ${promptFields} FROM cloud_prompt WHERE id=? AND ownerId=?`)
        .bind(id, owner)
        .first<CloudPrompt>();
      if (!prompt) throw new ApiFault(404, 'NOT_FOUND');
      const action = promptMatch[2];
      if (!action && request.method === 'GET') return cloudJson(prompt);
      if (action === 'versions' && request.method === 'GET')
        return cloudJson(
          (
            await db
              .prepare(
                'SELECT id,promptId,number,body,createdAt FROM cloud_version WHERE promptId=? AND ownerId=? ORDER BY number DESC LIMIT 200',
              )
              .bind(id, owner)
              .all()
          ).results,
        );
      const parent = await db
        .prepare('SELECT archived,deletedAt FROM cloud_project WHERE id=? AND ownerId=?')
        .bind(prompt.projectId, owner)
        .first<{ archived: number; deletedAt: string | null }>();
      if (!parent || parent.archived || parent.deletedAt)
        throw new ApiFault(403, 'PROJECT_READ_ONLY');
      if (!action && request.method === 'PATCH') {
        const data = promptPatch.parse(await input(request));
        if (prompt.deletedAt && data.deleted !== false) throw new ApiFault(403, 'PROMPT_READ_ONLY');
        let body = data.body ?? prompt.body;
        let restoring: CloudVersion | null = null;
        if (data.restoreVersion) {
          restoring = await db
            .prepare(
              'SELECT id,promptId,number,body,createdAt FROM cloud_version WHERE promptId=? AND ownerId=? AND number=?',
            )
            .bind(id, owner, data.restoreVersion)
            .first<CloudVersion>();
          if (!restoring) throw new ApiFault(404, 'NOT_FOUND');
          body = restoring.body;
        }
        const status = data.status ?? prompt.status;
        const checkpoint = Boolean(
          data.checkpoint || restoring || (status !== prompt.status && status !== 'draft'),
        );
        // Restoration preserves the current persisted draft as a checkpoint before adding the restored text.
        const increment = checkpoint ? (restoring ? 2 : 1) : 0;
        if (prompt.nextVersion + increment > 201) throw new ApiFault(422, 'VERSION_LIMIT');
        const token = crypto.randomUUID(),
          now = new Date().toISOString();
        const statements = [];
        statements.push(
          db
            .prepare(
              'UPDATE cloud_prompt SET title=?,body=?,status=?,priority=?,deletedAt=?,revision=revision+1,nextVersion=nextVersion+?,operation=?,updatedAt=? WHERE id=? AND ownerId=? AND revision=? AND EXISTS(SELECT 1 FROM cloud_project WHERE id=cloud_prompt.projectId AND ownerId=? AND archived=0 AND deletedAt IS NULL)',
            )
            .bind(
              data.title ?? prompt.title,
              body,
              status,
              data.priority ?? prompt.priority,
              data.deleted === undefined ? prompt.deletedAt : data.deleted ? now : null,
              increment,
              token,
              now,
              id,
              owner,
              data.revision,
              owner,
            ),
        );
        if (restoring)
          statements.push(
            db
              .prepare(
                'INSERT INTO cloud_version(id,promptId,ownerId,number,body,createdAt) SELECT ?,id,ownerId,nextVersion-2,?,? FROM cloud_prompt WHERE id=? AND ownerId=? AND operation=?',
              )
              .bind(crypto.randomUUID(), prompt.body, now, id, owner, token),
          );
        if (checkpoint)
          statements.push(
            db
              .prepare(
                'INSERT INTO cloud_version(id,promptId,ownerId,number,body,createdAt) SELECT ?,id,ownerId,nextVersion-1,body,? FROM cloud_prompt WHERE id=? AND ownerId=? AND operation=?',
              )
              .bind(crypto.randomUUID(), now, id, owner, token),
          );
        const results = await db.batch(statements);
        if (!results[0]?.meta.changes) throw new ApiFault(409, 'REVISION_CONFLICT');
        return cloudJson(
          await db
            .prepare(`SELECT ${promptFields} FROM cloud_prompt WHERE id=? AND ownerId=?`)
            .bind(id, owner)
            .first(),
        );
      }
      if (action === 'split' && request.method === 'POST') {
        const data = z
          .object({
            revision: z.number().int().positive(),
            from: z.number().int().nonnegative(),
            to: z.number().int().positive(),
          })
          .strict()
          .parse(await input(request));
        if (prompt.deletedAt || data.to <= data.from || data.to > prompt.body.length)
          throw new ApiFault(400, 'INVALID_SELECTION');
        const token = crypto.randomUUID(),
          newId = crypto.randomUUID(),
          now = new Date().toISOString();
        const r = await db.batch([
          db
            .prepare(
              'UPDATE cloud_prompt SET body=?,revision=revision+1,operation=?,updatedAt=? WHERE id=? AND ownerId=? AND revision=? AND (SELECT COUNT(*) FROM cloud_prompt WHERE ownerId=?)<500 AND EXISTS(SELECT 1 FROM cloud_project WHERE id=cloud_prompt.projectId AND ownerId=? AND archived=0 AND deletedAt IS NULL)',
            )
            .bind(
              prompt.body.slice(0, data.from) + prompt.body.slice(data.to),
              token,
              now,
              id,
              owner,
              data.revision,
              owner,
              owner,
            ),
          db
            .prepare(
              'INSERT INTO cloud_prompt(id,projectId,ownerId,body,sortOrder,createdAt,updatedAt) SELECT ?,projectId,ownerId,?,sortOrder+0.5,?,? FROM cloud_prompt WHERE id=? AND ownerId=? AND operation=?',
            )
            .bind(newId, prompt.body.slice(data.from, data.to), now, now, id, owner, token),
        ]);
        if (!r[0]?.meta.changes) throw new ApiFault(409, 'REVISION_CONFLICT');
        return cloudJson({ id: newId }, 201);
      }
    }
    throw new ApiFault(404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof ApiFault) return cloudJson({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return cloudJson({ error: 'INVALID_REQUEST' }, 400);
    // D1 CHECK constraints may indicate a storage quota. No SQL, identifiers or content leave the server.
    return cloudJson({ error: 'STORAGE_UNAVAILABLE' }, 503);
  }
}

async function handleAdmin(request: Request, env: WorkerEnvironment, owner: string, url: URL) {
  if (url.pathname === '/api/admin/users' && request.method === 'GET') {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(url.searchParams.get('offset') ?? 0);
    return cloudJson(
      (
        await env.DB.prepare(
          'SELECT u.id,u.name,u.email,u.createdAt,a.role,a.disabled,a.mustChangePassword FROM user u JOIN user_access a ON a.userId=u.id ORDER BY u.createdAt DESC,u.id LIMIT 25 OFFSET ?',
        )
          .bind(offset)
          .all()
      ).results,
    );
  }
  const match = /^\/api\/admin\/users\/([^/]+)$/.exec(url.pathname);
  if (match && request.method === 'DELETE') {
    const id = match[1];
    z.object({ confirmation: z.literal('删除用户') })
      .strict()
      .parse(await input(request));
    if (!id || id === owner) throw new ApiFault(400, 'SELF_MANAGEMENT_FORBIDDEN');
    const target = await getAccess(env, id);
    if (!target) throw new ApiFault(404, 'NOT_FOUND');
    if (target.role === 'admin') throw new ApiFault(403, 'ADMIN_PROTECTED');
    await env.DB.prepare(
      "DELETE FROM user WHERE id=? AND EXISTS(SELECT 1 FROM user_access WHERE userId=user.id AND role='user')",
    )
      .bind(id)
      .run();
    return cloudJson({ ok: true });
  }
  if (match && request.method === 'PATCH') {
    const id = match[1];
    const data = z
      .object({
        disabled: z.boolean().optional(),
        password: z.string().min(12).max(128).optional(),
      })
      .strict()
      .refine((v) => v.disabled !== undefined || v.password !== undefined)
      .parse(await input(request));
    if (!id || id === owner) throw new ApiFault(400, 'SELF_MANAGEMENT_FORBIDDEN');
    const target = await getAccess(env, id);
    if (!target) throw new ApiFault(404, 'NOT_FOUND');
    if (target.role === 'admin') throw new ApiFault(403, 'ADMIN_PROTECTED');
    const statements = [];
    if (data.disabled !== undefined)
      statements.push(
        env.DB.prepare("UPDATE user_access SET disabled=? WHERE userId=? AND role='user'").bind(
          Number(data.disabled),
          id,
        ),
      );
    if (data.password) {
      const hash = await hashPassword(data.password);
      statements.push(
        env.DB.prepare(
          "UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential'",
        ).bind(hash, new Date().toISOString(), id),
      );
      statements.push(
        env.DB.prepare('UPDATE user_access SET mustChangePassword=1 WHERE userId=?').bind(id),
      );
    }
    statements.push(env.DB.prepare('DELETE FROM session WHERE userId=?').bind(id));
    await env.DB.batch(statements);
    return cloudJson({ ok: true });
  }
  throw new ApiFault(404, 'NOT_FOUND');
}

// Anonymous, read-only view of a single shared project. No session, no ownerId, no versions.
export async function handlePublicShare(
  request: Request,
  env: WorkerEnvironment,
  url: URL,
): Promise<Response> {
  try {
    if (request.method !== 'GET') throw new ApiFault(405, 'METHOD_NOT_ALLOWED');
    const token = url.pathname.slice('/api/share/'.length);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new ApiFault(404, 'NOT_FOUND');
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const bucket = Math.floor(Date.now() / 60000);
    const accepted = await env.DB.prepare(
      'INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<>excluded.lastRequest THEN 1 ELSE count+1 END,lastRequest=excluded.lastRequest WHERE lastRequest<>excluded.lastRequest OR count<120 RETURNING count',
    )
      .bind(crypto.randomUUID(), `share-read:${ip}`, bucket)
      .first();
    if (!accepted) throw new ApiFault(429, 'RATE_LIMITED');
    const share = await env.DB.prepare(
      'SELECT projectId,ownerId FROM cloud_share WHERE token=? AND revokedAt IS NULL',
    )
      .bind(token)
      .first<{ projectId: string; ownerId: string }>();
    if (!share) throw new ApiFault(404, 'NOT_FOUND');
    const project = await env.DB.prepare(
      'SELECT name,description FROM cloud_project WHERE id=? AND ownerId=? AND deletedAt IS NULL',
    )
      .bind(share.projectId, share.ownerId)
      .first<{ name: string; description: string }>();
    if (!project) throw new ApiFault(404, 'NOT_FOUND');
    const prompts = (
      await env.DB.prepare(
        'SELECT title,body FROM cloud_prompt WHERE projectId=? AND ownerId=? AND deletedAt IS NULL ORDER BY sortOrder, createdAt LIMIT 500',
      )
        .bind(share.projectId, share.ownerId)
        .all<{ title: string; body: string }>()
    ).results;
    return cloudJson({
      project: { name: project.name, description: project.description },
      prompts,
    });
  } catch (error) {
    if (error instanceof ApiFault) return cloudJson({ error: error.code }, error.status);
    return cloudJson({ error: 'SERVICE_UNAVAILABLE' }, 503);
  }
}
