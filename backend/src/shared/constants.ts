// Warning statuses that indicate an active/open warning
export const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'] as const;

// Default attendance metrics tracked by the warning engine
export const DEFAULT_METRICS = ['late', 'absent', 'early_leave'] as const;

// Warning level severity weights (higher = more severe)
export const LEVEL_WEIGHT: Record<string, number> = {
  yellow: 1,
  orange: 2,
  red: 3,
  severe: 4,
};

// Default timezone
export const DEFAULT_TZ = 'Asia/Shanghai';

// Warning window evaluation order
export const WINDOW_ORDER = ['day', 'week', 'month', 'term'] as const;
