/**
 * Shared formatting utilities — eliminate duplication across pages.
 */

/** Format a date value to 'YYYY-MM-DD HH:mm' string */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

/** Format a date value to 'YYYY-MM-DD' string */
export function formatDate(value?: string | Date | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Escape HTML special characters to prevent XSS */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format gender code to Chinese text */
export function formatGender(gender?: string): string {
  if (gender === 'male') return '男';
  if (gender === 'female') return '女';
  return '未知';
}

/** Get Element Plus tag type for attendance status */
export function getAttendanceStatusType(status: string): string {
  if (status === 'not_started') return 'info';
  if (status === 'active') return 'success';
  if (status === 'inactive') return 'warning';
  return '';
}

/** Get Chinese text for attendance status */
export function getAttendanceStatusText(status: string): string {
  if (status === 'not_started') return '未开始';
  if (status === 'active') return '进行中';
  if (status === 'inactive') return '已结束';
  return status;
}
