const fs = require('fs');
const path = require('path');

const controllers = [
  'src/classes/classes.admin.controller.ts',
  'src/teachers/teachers.admin.controller.ts',
  'src/schedules/schedules.admin.controller.ts',
];

const modules = [
  'src/classes/classes.module.ts',
  'src/teachers/teachers.module.ts',
  'src/schedules/schedules.module.ts',
];

// 更新Controller文件
controllers.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log(`文件不存在: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // 替换import
  content = content.replace(
    /import \{ RolesGuard, Roles \} from ['"]\.\.\/shared\/roles\.guard['"];/,
    `import { PermissionGuard } from '../rbac/permission.guard';\nimport { Permissions, DataScope } from '../rbac/permission.decorator';`
  );

  // 替换UseGuards
  content = content.replace(
    /@UseGuards\(AuthGuard, RolesGuard\)/g,
    '@UseGuards(AuthGuard, PermissionGuard)'
  );

  // 替换@Roles为@Permissions（根据功能映射）
  // 这里简化处理，实际应该根据每个接口的功能精确映射
  content = content.replace(
    /@Roles\([^)]+\)/g,
    (match) => {
      // 根据文件路径推断权限前缀
      let prefix = 'system';
      if (file.includes('classes')) prefix = 'class';
      else if (file.includes('teachers')) prefix = 'user';
      else if (file.includes('schedules')) prefix = 'schedule';

      // 根据HTTP方法推断操作
      const nextLine = content.substring(content.indexOf(match) + match.length, content.indexOf(match) + match.length + 200);
      let action = 'read';
      if (nextLine.includes('@Get')) action = 'read';
      else if (nextLine.includes('@Post')) action = 'create';
      else if (nextLine.includes('@Put')) action = 'update';
      else if (nextLine.includes('@Delete')) action = 'delete';

      return `@Permissions('${prefix}:${action}')`;
    }
  );

  fs.writeFileSync(filePath, content);
  console.log(`已更新: ${filePath}`);
});

// 更新Module文件
modules.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log(`文件不存在: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // 添加RbacModule导入
  if (!content.includes('RbacModule')) {
    content = content.replace(
      /import \{ PrismaModule \} from ['"]\.\.\/shared\/prisma\.module['"];/,
      `import { PrismaModule } from '../shared/prisma.module';\nimport { RbacModule } from '../rbac/rbac.module';`
    );

    content = content.replace(
      /imports: \[PrismaModule\]/,
      'imports: [PrismaModule, RbacModule]'
    );

    fs.writeFileSync(filePath, content);
    console.log(`已更新Module: ${filePath}`);
  }
});

console.log('批量更新完成！');
