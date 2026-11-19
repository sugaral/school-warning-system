export const warningLevelPalette: Record<string, string> = {
  yellow: '#d4a017',
  orange: '#f97316',
  red: '#dc2626',
  severe: '#7c3aed',
};

export const warningLevelTextMap: Record<string, string> = {
  yellow: '黄色预警',
  orange: '橙色预警',
  red: '红色预警',
  severe: '严重预警',
};

export function getWarningLevelColor(level?: string) {
  return warningLevelPalette[String(level || '').trim()] || '#909399';
}

export function getWarningLevelText(level?: string) {
  return warningLevelTextMap[String(level || '').trim()] || String(level || '-');
}
