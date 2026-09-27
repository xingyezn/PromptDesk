import { useState } from 'react';
import { authClient } from '../services/api/authClient';
import { cloudClient, cloudErrorMessage } from '../services/api/cloudClient';
import type { ManagedUser } from '../domain/cloud';

export function ChangePassword({ required, onDone }: { required: boolean; onDone: () => void }) {
  const [oldPassword, setOld] = useState(''),
    [newPassword, setNew] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section className="cloud-account-section">
      <h2>{required ? '请先修改初始密码' : '修改密码'}</h2>
      <p>至少 12 个字符。修改后其他设备会退出登录。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (newPassword !== confirmation) {
            setMessage('两次输入的密码不一致。');
            return;
          }
          setBusy(true);
          setMessage('');
          void authClient
            .changePassword({
              currentPassword: oldPassword,
              newPassword,
              revokeOtherSessions: true,
            })
            .then((result) => {
              if (result.error) setMessage('修改失败，请检查当前密码。');
              else {
                setOld('');
                setNew('');
                setConfirmation('');
                setMessage('密码已修改。');
                onDone();
              }
            })
            .catch(() => setMessage('服务暂时不可用，请重试。'))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(e) => setOld(e.target.value)}
            required
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <button className="primary-button" disabled={busy}>
          保存新密码
        </button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}

export function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]),
    [offset, setOffset] = useState(0),
    [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [resetId, setResetId] = useState<string | null>(null),
    [password, setPassword] = useState('');
  const load = async (page: number) => {
    setBusy(true);
    try {
      setUsers(await cloudClient.users(page));
      setOffset(page);
      setLoaded(true);
    } catch (e) {
      setMessage(cloudErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const manage = async (id: string, patch: { disabled?: boolean; password?: string }) => {
    setBusy(true);
    try {
      await cloudClient.manageUser(id, patch);
      setResetId(null);
      setPassword('');
      await load(offset);
      setMessage('已更新账户，原有会话已撤销。');
    } catch (e) {
      setMessage(cloudErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('永久删除这个用户及其全部项目、提示词和版本？此操作不可撤销。')) return;
    setBusy(true);
    try {
      await cloudClient.removeUser(id);
      await load(offset);
      setMessage('已永久删除用户及其个人空间。');
    } catch (error) {
      setMessage(cloudErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cloud-account-section">
      <h2>用户管理</h2>
      <p>管理员仅管理账户，不查看其他用户的提示词。</p>
      {!loaded ? (
        <button disabled={busy} onClick={() => void load(0)}>
          加载用户
        </button>
      ) : (
        <>
          <ul className="cloud-user-list">
            {users.map((user) => (
              <li key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <p>{user.email}</p>
                  <small>
                    {user.role === 'admin' ? '管理员' : user.disabled ? '已停用' : '正常'}
                  </small>
                </div>
                {user.role !== 'admin' && (
                  <div className="cloud-user-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            user.disabled
                              ? '重新启用这个账户？'
                              : '停用后用户会退出登录，确认停用？',
                          )
                        )
                          void manage(user.id, { disabled: !user.disabled });
                      }}
                    >
                      {user.disabled ? '启用' : '停用'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setResetId(user.id);
                        setPassword('');
                      }}
                    >
                      重置密码
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      onClick={() => void remove(user.id)}
                    >
                      删除用户
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="cloud-inline">
            <button
              disabled={busy || offset === 0}
              onClick={() => void load(Math.max(0, offset - 25))}
            >
              上一页
            </button>
            <span>第 {offset / 25 + 1} 页</span>
            <button disabled={busy || users.length < 25} onClick={() => void load(offset + 25)}>
              下一页
            </button>
          </div>
        </>
      )}
      {resetId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (window.confirm('重置密码并撤销用户全部会话？用户下次登录需要修改密码。'))
              void manage(resetId, { password });
          }}
        >
          <label>
            新临时密码
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>确认重置</button>
          <button type="button" onClick={() => setResetId(null)}>
            取消
          </button>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
