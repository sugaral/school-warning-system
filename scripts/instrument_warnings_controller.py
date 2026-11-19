import pathlib
path = pathlib.Path('/www/wwwroot/cursor-x/backend/src/warnings/warnings.controller.ts')
text = path.read_text()
repls = [
("""    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    const roles = userRoles.map((item: any) => item.role);
""","""    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    step('user_roles');
    const roles = userRoles.map((item: any) => item.role);
""",1),
("""    if (courseId && courseId !== 'all') {
      where.course_id = BigInt(courseId);
    }

    const orderingField = normalizedScope === 'active' ? 'updated_at' : 'created_at';
""","""    if (courseId && courseId !== 'all') {
      where.course_id = BigInt(courseId);
    }
    step('scope_ready');

    const orderingField = normalizedScope === 'active' ? 'updated_at' : 'created_at';
""",1),
("""    const warningTotalsRows = await this.prisma.$queryRawUnsafe<Array<{ warning_total: number | bigint | string | null }>>(
      `SELECT COUNT(*) AS warning_total FROM ${paginationSource} ${whereSql}`,
      ...whereParams,
    );
    const warningTotal = Number(warningTotalsRows?.[0]?.warning_total || 0);
""","""    const warningTotalsRows = await this.prisma.$queryRawUnsafe<Array<{ warning_total: number | bigint | string | null }>>(
      `SELECT COUNT(*) AS warning_total FROM ${paginationSource} ${whereSql}`,
      ...whereParams,
    );
    step('warning_total');
    const warningTotal = Number(warningTotalsRows?.[0]?.warning_total || 0);
""",1),
("""    const studentTotalRows = await this.prisma.$queryRawUnsafe<Array<{ total: number | bigint | string | null }>>(
      `SELECT COUNT(DISTINCT student_id) AS total FROM ${paginationSource} ${whereSql}`,
      ...whereParams,
    );
    const total = Number(studentTotalRows?.[0]?.total || 0);
""","""    const studentTotalRows = await this.prisma.$queryRawUnsafe<Array<{ total: number | bigint | string | null }>>(
      `SELECT COUNT(DISTINCT student_id) AS total FROM ${paginationSource} ${whereSql}`,
      ...whereParams,
    );
    step('student_total');
    const total = Number(studentTotalRows?.[0]?.total || 0);
""",1),
("""    const violationRows = await this.prisma.$queryRawUnsafe<Array<{ violation_total: number | bigint | string | null }>>(
      `SELECT COALESCE(SUM(max_violation_count), 0) AS violation_total
       FROM (
         SELECT student_id,
                COALESCE(
                  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(trigger_detail_json, '$.course_id')), ''),
                  '__none__'
                ) AS course_key,
                COALESCE(NULLIF(metric, ''), '__unknown__') AS metric_key,
                MAX(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(trigger_detail_json, '$.violation_count')) AS UNSIGNED), 0)) AS max_violation_count
         FROM ${paginationSource}
         ${whereSql}
         GROUP BY student_id, course_key, metric_key
       ) grouped_violations`,
      ...whereParams,
    );
    const violationTotal = Number(violationRows?.[0]?.violation_total || 0);
""","""    const violationRows = await this.prisma.$queryRawUnsafe<Array<{ violation_total: number | bigint | string | null }>>(
      `SELECT COALESCE(SUM(max_violation_count), 0) AS violation_total
       FROM (
         SELECT student_id,
                COALESCE(
                  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(trigger_detail_json, '$.course_id')), ''),
                  '__none__'
                ) AS course_key,
                COALESCE(NULLIF(metric, ''), '__unknown__') AS metric_key,
                MAX(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(trigger_detail_json, '$.violation_count')) AS UNSIGNED), 0)) AS max_violation_count
         FROM ${paginationSource}
         ${whereSql}
         GROUP BY student_id, course_key, metric_key
       ) grouped_violations`,
      ...whereParams,
    );
    step('violation_total');
    const violationTotal = Number(violationRows?.[0]?.violation_total || 0);
""",1),
("""    const pageStudentRows = await this.prisma.$queryRawUnsafe<Array<{ student_id: bigint }>>(
      `SELECT student_id
       FROM (
         SELECT student_id, MAX(${orderingField}) AS latest_order
         FROM ${paginationSource}
         ${whereSql}
         GROUP BY student_id
         ORDER BY latest_order DESC, student_id DESC
         LIMIT ? OFFSET ?
       ) page_students`,
      ...whereParams,
      size,
      skip,
    );
    const pageStudentIds = pageStudentRows.map((item) => BigInt(item.student_id as any));
""","""    const pageStudentRows = await this.prisma.$queryRawUnsafe<Array<{ student_id: bigint }>>(
      `SELECT student_id
       FROM (
         SELECT student_id, MAX(${orderingField}) AS latest_order
         FROM ${paginationSource}
         ${whereSql}
         GROUP BY student_id
         ORDER BY latest_order DESC, student_id DESC
         LIMIT ? OFFSET ?
       ) page_students`,
      ...whereParams,
      size,
      skip,
    );
    step('page_students');
    const pageStudentIds = pageStudentRows.map((item) => BigInt(item.student_id as any));
""",1),
("""    const warnings = normalizedScope === 'active'
      ? await (this.prisma as any).warning_current_states.findMany({
          where: pageWhere,
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        })
      : await this.prisma.warnings.findMany({
          where: pageWhere,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });

    const studentIds = this.uniqueBigInts(warnings.map((item: any) => item.student_id));
""","""    const warnings = normalizedScope === 'active'
      ? await (this.prisma as any).warning_current_states.findMany({
          where: pageWhere,
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        })
      : await this.prisma.warnings.findMany({
          where: pageWhere,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
    step('warnings_findMany');

    const studentIds = this.uniqueBigInts(warnings.map((item: any) => item.student_id));
""",1),
("""    const processingMap =
      normalizedScope === 'active'
        ? await this.warningProcessingService.getStudentProcessingMap(studentIds)
        : new Map<string, { status: string; text: string }>();

    const [students, classes] = await Promise.all([
""","""    const processingMap =
      normalizedScope === 'active'
        ? await this.warningProcessingService.getStudentProcessingMap(studentIds)
        : new Map<string, { status: string; text: string }>();
    step('processing_map');

    const [students, classes] = await Promise.all([
""",1),
("""    const [students, classes] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          users: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          class_name: true,
          org_id: true,
          counselor_user_id: true,
        },
      }),
    ]);

    const teacherIds = this.uniqueBigInts(
""","""    const [students, classes] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          users: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          class_name: true,
          org_id: true,
          counselor_user_id: true,
        },
      }),
    ]);
    step('students_classes');

    const teacherIds = this.uniqueBigInts(
""",1),
("""    const [teachers, orgs] = await Promise.all([
      teacherIds.length > 0
        ? this.prisma.users.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      orgIds.length > 0
        ? this.prisma.orgs.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const studentMap = new Map<string, any>(students.map((item: any) => [item.id.toString(), item]));
""","""    const [teachers, orgs] = await Promise.all([
      teacherIds.length > 0
        ? this.prisma.users.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      orgIds.length > 0
        ? this.prisma.orgs.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    step('teachers_orgs');

    const studentMap = new Map<string, any>(students.map((item: any) => [item.id.toString(), item]));
""",1),
("""    const items = warnings.map((warning: any) => {
""","""    const items = warnings.map((warning: any) => {
""",1),
("""    return {
      code: 0,
""","""    step('items_mapped');
    return {
      code: 0,
""",1),
]
for old,new,count in repls:
    if old not in text:
        raise SystemExit('missing block:\n'+old[:200])
    text = text.replace(old,new,count)
path.write_text(text)
print('ok')
