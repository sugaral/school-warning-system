/**
 * 更新用户密码脚本
 * 用法: npx ts-node prisma/update-password.ts <用户ID> <新密码>
 * 示例: npx ts-node prisma/update-password.ts 2002 admin123
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const userId = process.argv[2];
  const newPassword = process.argv[3];

  if (!userId || !newPassword) {
    console.log('用法: npx ts-node prisma/update-password.ts <用户ID> <新密码>');
    console.log('示例: npx ts-node prisma/update-password.ts 2002 admin123');
    process.exit(1);
  }

  console.log(`正在为用户 ${userId} 更新密码...`);

  // 生成 bcrypt 密码哈希
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // 更新用户密码
  const user = await prisma.users.update({
    where: { id: BigInt(userId) },
    data: { password_hash: passwordHash },
  });

  console.log('✅ 密码更新成功！');
  console.log(`用户: ${user.name}`);
  console.log(`手机号: ${user.mobile}`);
  console.log(`邮箱: ${user.email}`);
  console.log(`新密码: ******${newPassword.slice(-4)}`);
}

main()
  .catch((e) => {
    console.error('更新失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
