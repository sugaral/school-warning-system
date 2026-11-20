import { canAccessFileRecord } from './file-access.util';

describe('canAccessFileRecord', () => {
  const ownerRecord = { uploader_user_id: BigInt(101) };

  it('允许上传者本人读取（bigint 与字符串 id 都要能对上）', () => {
    expect(canAccessFileRecord({ userId: '101', userType: 'student' }, ownerRecord)).toBe(true);
    expect(canAccessFileRecord({ userId: 101, userType: 'teacher' }, ownerRecord)).toBe(true);
  });

  it('拒绝学生读取他人文件', () => {
    expect(canAccessFileRecord({ userId: '102', userType: 'student' }, ownerRecord)).toBe(false);
  });

  it('允许非学生账号读取（权限码由调用方校验）', () => {
    expect(canAccessFileRecord({ userId: '900', userType: 'teacher' }, ownerRecord)).toBe(true);
    expect(canAccessFileRecord({ userId: '900', userType: 'admin' }, ownerRecord)).toBe(true);
    expect(canAccessFileRecord({ userId: '900', userType: 'staff' }, ownerRecord)).toBe(true);
  });

  it('缺少 userType 时拒绝，避免匿名上下文被当成管理员', () => {
    expect(canAccessFileRecord({ userId: '102' }, ownerRecord)).toBe(false);
    expect(canAccessFileRecord({ userId: '102', userType: '' }, ownerRecord)).toBe(false);
  });

  it('记录缺失时拒绝', () => {
    expect(canAccessFileRecord({ userId: '101', userType: 'admin' }, null)).toBe(false);
    expect(canAccessFileRecord({ userId: '101', userType: 'admin' }, undefined)).toBe(false);
  });

  it('上传者字段为空时，学生一律拒绝', () => {
    expect(canAccessFileRecord({ userId: '101', userType: 'student' }, {})).toBe(false);
    expect(canAccessFileRecord({ userId: '101', userType: 'student' }, { uploader_user_id: null })).toBe(false);
  });
});
