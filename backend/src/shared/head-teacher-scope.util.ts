import { PrismaService } from './prisma.service';

type HeadTeacherScopeOptions = {
  activeOnly?: boolean;
};

function uniqueBigInts(values: Array<bigint | null | undefined>) {
  const map = new Map<string, bigint>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    map.set(value.toString(), value);
  }
  return Array.from(map.values());
}

export async function getHeadTeacherClassScopeIds(
  prisma: PrismaService,
  userId: bigint,
  options: HeadTeacherScopeOptions = {},
) {
  const classWhere: Record<string, any> = {
    counselor_user_id: userId,
  };

  if (options.activeOnly) {
    classWhere.status = 'active';
  }

  const [roleScopes, classScopes] = await Promise.all([
    prisma.user_roles.findMany({
      where: {
        user_id: userId,
        role: 'head_teacher',
        scope_id: { not: null },
      },
      select: { scope_id: true },
    }),
    prisma.classes.findMany({
      where: classWhere,
      select: { id: true },
    }),
  ]);

  return uniqueBigInts([
    ...roleScopes.map((item: any) => item.scope_id as bigint | null),
    ...classScopes.map((item: any) => item.id as bigint | null),
  ]);
}

export async function getHeadTeacherOrgScopeIds(
  prisma: PrismaService,
  userId: bigint,
  options: HeadTeacherScopeOptions = {},
) {
  const classIds = await getHeadTeacherClassScopeIds(prisma, userId, options);
  if (classIds.length === 0) {
    return [];
  }

  const classes = await prisma.classes.findMany({
    where: { id: { in: classIds } },
    select: { org_id: true },
  });

  return uniqueBigInts(classes.map((item: any) => item.org_id as bigint | null));
}
