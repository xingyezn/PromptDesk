export type ErrorCode =
  | 'UNSUPPORTED'
  | 'CANCELLED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'SCHEMA_TOO_NEW'
  | 'CONFLICT'
  | 'BUSY'
  | 'WRITE_FAILED'
  | 'CACHE_UNAVAILABLE'
  | 'RECOVERY_REQUIRED'
  | 'PATH_INVALID'
  | 'TRANSFER_LIMIT'
  | 'UNRECOGNIZED_FILES'
  | 'DESTINATION_NOT_EMPTY';

const messages: Record<ErrorCode, string> = {
  TRANSFER_LIMIT:
    '当前打包/迁移支持最多 5000 个文件、合计 32 MiB。请使用系统文件管理器备份更大的工作空间。',
  UNRECOGNIZED_FILES:
    '应用数据目录内有无法识别的文件，已停止打包或迁移以免遗漏。请先检查目录；根目录的其他资料不受影响。',
  DESTINATION_NOT_EMPTY: '迁移目标必须是空文件夹，请重新选择。原工作空间保持不变。',
  UNSUPPORTED: '请使用安全连接下的桌面 Chrome 或 Edge 打开本地工作空间。',
  CANCELLED: '已取消操作。',
  PERMISSION_DENIED: '目录访问权限不可用。请重新授权或重新选择目录，未保存内容仍保留。',
  NOT_FOUND: '所需文件不存在，请检查工作空间目录。',
  INVALID_JSON: '文件内容不是有效的 JSON，未对原文件做任何修复。',
  INVALID_SCHEMA: '数据格式或关联不正确，请检查文件；原内容已保留。',
  SCHEMA_TOO_NEW: '该工作空间由更高版本创建，请升级应用后打开。',
  CONFLICT: '检测到文件已被外部修改。请先复制未保存内容，再重新加载磁盘文件。',
  BUSY: '工作空间已在另一个窗口打开，当前只读。',
  WRITE_FAILED: '保存失败，未保存内容仍保留。请检查权限或设备后重试。',
  CACHE_UNAVAILABLE: '浏览器缓存不可用，最近目录和草稿恢复功能暂不可用。',
  RECOVERY_REQUIRED: '存在未完成的文件保存，请完成或回退后再继续编辑。',
  PATH_INVALID: '文件路径不符合安全规则，已停止操作。',
};

export class AppFault extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
    this.name = 'AppFault';
  }
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppFault };
export function normalizeError(error: unknown): AppFault {
  if (error instanceof AppFault) return error;
  if (error instanceof Error) {
    if (error.name === 'ZodError') return new AppFault('INVALID_SCHEMA');
    if (error.name === 'AbortError') return new AppFault('CANCELLED');
    if (['NotAllowedError', 'SecurityError'].includes(error.name))
      return new AppFault('PERMISSION_DENIED');
    if (error.name === 'NotFoundError') return new AppFault('NOT_FOUND');
  }
  return new AppFault('WRITE_FAILED');
}
export async function attempt<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
