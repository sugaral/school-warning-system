export type TableSpacingSettings = {
  headerPaddingX: number;
  headerPaddingY: number;
  bodyPaddingX: number;
  bodyPaddingY: number;
};

const STORAGE_KEY = 'ws_table_spacing_settings';

export const DEFAULT_TABLE_SPACING: TableSpacingSettings = {
  headerPaddingX: 18,
  headerPaddingY: 16,
  bodyPaddingX: 18,
  bodyPaddingY: 15,
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

export const normalizeTableSpacing = (value?: Partial<TableSpacingSettings> | null) => ({
  headerPaddingX: clamp(value?.headerPaddingX, 8, 40, DEFAULT_TABLE_SPACING.headerPaddingX),
  headerPaddingY: clamp(value?.headerPaddingY, 8, 28, DEFAULT_TABLE_SPACING.headerPaddingY),
  bodyPaddingX: clamp(value?.bodyPaddingX, 8, 40, DEFAULT_TABLE_SPACING.bodyPaddingX),
  bodyPaddingY: clamp(value?.bodyPaddingY, 8, 28, DEFAULT_TABLE_SPACING.bodyPaddingY),
});

export const readTableSpacingSettings = () => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_TABLE_SPACING };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_TABLE_SPACING };
    }
    return normalizeTableSpacing(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TABLE_SPACING };
  }
};

export const saveTableSpacingSettings = (value: TableSpacingSettings) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTableSpacing(value)));
};

export const applyTableSpacingSettings = (value?: Partial<TableSpacingSettings> | null) => {
  if (typeof document === 'undefined') {
    return normalizeTableSpacing(value);
  }

  const normalized = normalizeTableSpacing(value);
  const root = document.documentElement;
  root.style.setProperty('--ws-table-header-padding-x', `${normalized.headerPaddingX}px`);
  root.style.setProperty('--ws-table-header-padding-y', `${normalized.headerPaddingY}px`);
  root.style.setProperty('--ws-table-body-padding-x', `${normalized.bodyPaddingX}px`);
  root.style.setProperty('--ws-table-body-padding-y', `${normalized.bodyPaddingY}px`);
  return normalized;
};
