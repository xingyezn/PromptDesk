import { useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { authClient } from '../services/api/authClient';
import { isPreviewDeployment, productionUrl } from '../services/api/deployment';

type AccountMode = 'sign-in' | 'sign-up';

function getSafeErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '账户服务暂时不可用，请稍后重试。';
  const candidate = error as { status?: unknown; code?: unknown };
  if (candidate.status === 429) return '操作太频繁，请稍后再试。';
  if (candidate.code === 'INVALID_EMAIL_OR_PASSWORD') return '邮箱或密码不正确。';
  if (candidate.code === 'ACCOUNT_DISABLED') return '账户已停用，请联系管理员。';
  return '账户服务暂时不可用，请检查网络后重试。';
}

export function AccountPage({
  onBack,
  allowDelete = true,
}: {
  onBack?: () => void;
  allowDelete?: boolean;
}) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [mode, setMode] = useState<AccountMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);

  async function run(action: () => Promise<{ error?: unknown }>, successMessage: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (result.error) setError(getSafeErrorMessage(result.error));
      else {
        setNotice(successMessage);
        await refetch();
      }
    } catch {
      setError('账户服务暂时不可用，请检查网络后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'sign-up' && password.length < 12) {
      setError('密码至少需要 12 个字符。');
      return;
    }
    if (mode === 'sign-up' && password !== confirmation) {
      setError('两次输入的密码不一致。');
      return;
    }
    if (mode === 'sign-in') {
      await run(
        () =>
          authClient.signIn.email({
            email: email.trim().toLowerCase(),
            password,
          }),
        '已登录。',
      );
    } else if (mode === 'sign-up') {
      await run(
        () =>
          authClient.signUp.email({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
          }),
        '账户已创建并登录。当前版本不发送验证邮件，请使用可访问的邮箱作为登录名。',
      );
    }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== '删除') {
      setError('请输入“删除”以确认此操作。');
      return;
    }
    const deletePassword = password;
    setBusy(true);
    setError('');
    try {
      const result = await authClient.deleteUser({ password: deletePassword });
      if (result.error) setError(getSafeErrorMessage(result.error));
      else {
        await authClient.signOut();
        setNotice('账户已删除。');
        setDeleteMode(false);
        setPassword('');
        setConfirmation('');
        await refetch();
      }
    } catch {
      setError('账户暂时无法删除，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  const sessionUser = session?.user;
  const heading = {
    'sign-in': '登录 PromptDesk',
    'sign-up': '创建账户',
  }[mode];

  return (
    <main className="account-page">
      <div className="account-card">
        {onBack && (
          <button className="account-back" onClick={onBack}>
            <ArrowLeft size={17} /> 返回
          </button>
        )}
        <div className="account-brand">
          <span className="logo">
            <ShieldCheck size={19} />
          </span>
          <span>PromptDesk 账户</span>
        </div>
        {isPreviewDeployment && (
          <p className="account-environment" role="note">
            测试环境 · 账户和数据与正式版独立。<a href={productionUrl}>打开正式版</a>
          </p>
        )}
        {isPending ? (
          <p role="status">正在检查登录状态…</p>
        ) : sessionUser ? (
          <>
            <h1>账户设置</h1>
            <p className="account-user-name">{sessionUser.name}</p>
            <p className="muted">{sessionUser.email}</p>
            <p className="account-privacy">
              项目、提示词和历史版本保存在你的服务器个人空间。删除账户将永久删除这些数据。
            </p>
            {deleteMode ? (
              <form className="account-form" onSubmit={deleteAccount}>
                <label>
                  当前密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
                <label>
                  输入“删除”确认
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    required
                  />
                </label>
                <button className="danger-button" disabled={busy}>
                  永久删除账户
                </button>
                <button type="button" disabled={busy} onClick={() => setDeleteMode(false)}>
                  取消
                </button>
              </form>
            ) : (
              <div className="account-actions">
                <button
                  disabled={busy}
                  onClick={() => void run(() => authClient.signOut(), '已退出登录。')}
                >
                  退出登录
                </button>
                {allowDelete && (
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() => setDeleteMode(true)}
                  >
                    删除账户
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <h1>{heading}</h1>
            <p className="muted">
              登录后进入你的个人空间，可在电脑和手机上继续编辑。邮箱仅用作登录名，目前不发送验证邮件。
            </p>
            <form className="account-form" onSubmit={(event) => void submit(event)}>
              {mode === 'sign-up' && (
                <label>
                  显示名称
                  <input
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={80}
                  />
                </label>
              )}
              <label>
                邮箱
                <input
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={254}
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={mode === 'sign-in' ? 1 : 12}
                  maxLength={128}
                />
              </label>
              {mode === 'sign-up' && (
                <label>
                  确认密码
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    required
                    minLength={12}
                    maxLength={128}
                  />
                </label>
              )}
              <button className="primary-button" disabled={busy}>
                {busy ? '请稍候…' : heading}
              </button>
            </form>
            {mode === 'sign-in' && (
              <div className="account-links">
                <button
                  onClick={() => {
                    setMode('sign-up');
                    setError('');
                  }}
                >
                  创建账户
                </button>
              </div>
            )}
            {mode !== 'sign-in' && (
              <button
                className="account-link-back"
                onClick={() => {
                  setMode('sign-in');
                  setError('');
                }}
              >
                返回登录
              </button>
            )}
          </>
        )}
        {notice && (
          <p className="account-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
