    const pageWhere = {
      ...where,
      student_id: { in: pageStudentIds },
    };
    const includeViolationTotal = pageNumber === 1 && size <= 50;
    const warningListBaseSelect = {
      id: true,
      student_id: true,
      class_id: true,
      org_id: true,
      level: true,
      metric: true,
      window: true,
      period_start: true,
      period_end: true,
      rule_id: true,
      rule_snapshot_json: true,
      trigger_summary: true,
      trigger_detail_json: true,
      status: true,
      created_at: true,
      updated_at: true,
      acknowledged_at: true,
      acknowledged_by: true,
    };
    const activeWarningSelect = {
      ...warningListBaseSelect,
      course_id: true,
      course_key: true,
      current_count: true,
    };
    const historyWarningSelect = {
      ...warningListBaseSelect,
      closed_at: true,
      closed_by: true,
      close_note: true,
    };
    const warnings = normalizedScope === 'active'
      ? await (this.prisma).warning_current_states.findMany({
          where: pageWhere,
          select: activeWarningSelect,
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        })
      : await this.prisma.warnings.findMany({
          where: pageWhere,
          select: historyWarningSelect,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
    step('warnings_findMany');

    const violationTotal = includeViolationTotal ? this.computeDedupedViolationTotal(warnings) : null;

    const studentIds = this.uniqueBigInts(warnings.map((item) => item.student_id));
    const classIds = this.uniqueBigInts(warnings.map((item) => item.class_id));
    const processingMap =
      normalizedScope === 'active'
        ? await this.warningProcessingService.getStudentProcessingMap(studentIds)
        : new Map();
    step('processing_map');

    const [students, classes] = await Promise.all([
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
      classes.map((item) => item.counselor_user_id).filter((item) => Boolean(item)),
    );
    const orgIds = this.uniqueBigInts([
      ...warnings.map((item) => item.org_id),
      ...classes.map((item) => item.org_id),
    ]);

    const [teachers, orgs] = await Promise.all([
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

    const studentMap = new Map(students.map((item) => [item.id.toString(), item]));
    const classMap = new Map(classes.map((item) => [item.id.toString(), item]));
    const teacherMap = new Map(teachers.map((item) => [item.id.toString(), item]));
    const orgMap = new Map(orgs.map((item) => [item.id.toString(), item]));

    const items = warnings.map((warning) => {
      const student = studentMap.get(warning.student_id.toString());
      const classInfo = classMap.get(warning.class_id.toString());
      const teacher = classInfo?.counselor_user_id
        ? teacherMap.get(classInfo.counselor_user_id.toString())
        : null;
      const org = orgMap.get((classInfo?.org_id || warning.org_id).toString());
      const detail = (warning.trigger_detail_json) || {};
      const displayStatus = this.getDisplayStatus(warning);

      return {
        id: warning.id.toString(),
        student_id: warning.student_id.toString(),
        class_id: warning.class_id.toString(),
        org_id: warning.org_id.toString(),
        level: warning.level,
        metric: warning.metric,
        window: warning.window,
        period_start: warning.period_start,
        period_end: warning.period_end,
        rule_id: warning.rule_id.toString(),
        rule_snapshot_json: warning.rule_snapshot_json,
        trigger_summary: warning.trigger_summary,
        trigger_detail_json: warning.trigger_detail_json,
        course_id: detail.course_id || (warning.course_id ? warning.course_id.toString() : ''),
        course_name: detail.course_name || '',
        violation_count: Number(detail.violation_count || warning.current_count || 0),
        status: warning.status,
        display_status: displayStatus.display_status,
        display_status_text: displayStatus.display_status_text,
        created_at: warning.created_at,
        updated_at: warning.updated_at,
        acknowledged_at: warning.acknowledged_at,
        acknowledged_by: warning.acknowledged_by?.toString(),
        closed_at: normalizedScope === 'active' ? null : warning.closed_at,
        closed_by: normalizedScope === 'active' ? '' : warning.closed_by?.toString(),
        close_note: normalizedScope === 'active' ? '' : warning.close_note,
        student_name: student?.users?.name || '未知学生',
        class_name: classInfo?.class_name || '未知班级',
        teacher_name: teacher?.name || '未知班主任',
        org_name: org?.name || '未知学院',
        processing_status: processingMap.get(warning.student_id.toString())?.status || '',
        processing_text: processingMap.get(warning.student_id.toString())?.text || '',
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        total: normalizedScope === 'active' ? warningTotal : total,
        student_total: total,
        warning_total: warningTotal,
        violation_total: violationTotal,
        page: pageNumber,
        page_size: size,
        items,
      },
      trace_id: req.trace_id,
    };
  }

