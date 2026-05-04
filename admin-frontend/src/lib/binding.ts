const STUDENT_BOUND_KEY = 'student_is_bound';
const HEAD_TEACHER_BOUND_KEY = 'head_teacher_is_bound';
const STUDENT_ADMIN_BOUND_KEY = 'student_admin_is_bound';
const TEACHER_BOUND_ORG_KEY = 'teacher_has_bound_org';
const TEACHER_BOUND_COURSES_KEY = 'teacher_has_bound_courses';

type NullableBoolean = boolean | null;

function readBoolean(key: string): NullableBoolean {
  const value = localStorage.getItem(key);
  if (value === '1') {
    return true;
  }
  if (value === '0') {
    return false;
  }
  return null;
}

function writeBoolean(key: string, value: NullableBoolean) {
  if (value === null) {
    localStorage.removeItem(key);
    return;
  }

  localStorage.setItem(key, value ? '1' : '0');
}

export function clearBindingStateCache() {
  [
    STUDENT_BOUND_KEY,
    HEAD_TEACHER_BOUND_KEY,
    STUDENT_ADMIN_BOUND_KEY,
    TEACHER_BOUND_ORG_KEY,
    TEACHER_BOUND_COURSES_KEY,
  ].forEach((key) => localStorage.removeItem(key));
}

export function getStudentBoundState(): NullableBoolean {
  return readBoolean(STUDENT_BOUND_KEY);
}

export function setStudentBoundState(value: NullableBoolean) {
  writeBoolean(STUDENT_BOUND_KEY, value);
}

export function getHeadTeacherBoundState(): NullableBoolean {
  return readBoolean(HEAD_TEACHER_BOUND_KEY);
}

export function setHeadTeacherBoundState(value: NullableBoolean) {
  writeBoolean(HEAD_TEACHER_BOUND_KEY, value);
}

export function getStudentAdminBoundState(): NullableBoolean {
  return readBoolean(STUDENT_ADMIN_BOUND_KEY);
}

export function setStudentAdminBoundState(value: NullableBoolean) {
  writeBoolean(STUDENT_ADMIN_BOUND_KEY, value);
}

export function getTeacherBindingState() {
  return {
    hasBoundOrg: readBoolean(TEACHER_BOUND_ORG_KEY),
    hasBoundCourses: readBoolean(TEACHER_BOUND_COURSES_KEY),
  };
}

export function setTeacherBindingState(payload: {
  hasBoundOrg?: NullableBoolean;
  hasBoundCourses?: NullableBoolean;
}) {
  if (payload.hasBoundOrg !== undefined) {
    writeBoolean(TEACHER_BOUND_ORG_KEY, payload.hasBoundOrg);
  }
  if (payload.hasBoundCourses !== undefined) {
    writeBoolean(TEACHER_BOUND_COURSES_KEY, payload.hasBoundCourses);
  }
}

export function updateStoredRoleScope(roleCode: string, scopeId: string | null | undefined) {
  const raw = localStorage.getItem('admin_roles_full');
  if (!raw) {
    return;
  }

  try {
    const roles = JSON.parse(raw);
    if (!Array.isArray(roles)) {
      return;
    }

    const nextRoles = roles.map((item: any) => {
      if (item?.role !== roleCode) {
        return item;
      }

      return {
        ...item,
        scope_id: scopeId || null,
      };
    });

    localStorage.setItem('admin_roles_full', JSON.stringify(nextRoles));
  } catch {
    // Ignore invalid cache data and keep navigation usable.
  }
}
