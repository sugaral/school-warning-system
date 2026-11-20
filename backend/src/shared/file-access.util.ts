/**
 * 文件访问归属判定（纯函数，便于单测）。
 *
 * 背景：`GET /files/:id` 原本没有任何权限码，`GET /files/:id/download` 只校验
 * `file:download`，两者都不校验归属 —— 任何持有对应权限的账号都能按自增 id
 * 遍历读取他人的证件照 / 请假凭证 / 申诉证据。
 *
 * 规则：
 *   1. 上传者本人永远可以读自己的文件；
 *   2. 非学生账号（管理员 / 教师 / 学工）在通过各自权限码后可以读；
 *   3. 学生只能读自己的。
 */
export type FileAccessActor = {
  userId?: string | number | null;
  userType?: string | null;
};

export type FileAccessRecord = {
  uploader_user_id?: bigint | number | string | null;
};

export function canAccessFileRecord(
  actor: FileAccessActor | null | undefined,
  record: FileAccessRecord | null | undefined,
): boolean {
  if (!record) {
    return false;
  }

  const userId = String(actor?.userId ?? '').trim();
  const uploaderId = record.uploader_user_id
    ? String(record.uploader_user_id).trim()
    : '';

  if (userId && uploaderId && userId === uploaderId) {
    return true;
  }

  const userType = String(actor?.userType ?? '')
    .trim()
    .toLowerCase();

  // 学生只能读自己上传的文件；其余角色由各自的权限码把关
  return Boolean(userType) && userType !== 'student';
}
