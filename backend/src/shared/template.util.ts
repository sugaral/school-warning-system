export function renderTemplate(template: string, params: Record<string, any> = {}) {
  let result = template;

  for (const [key, value] of Object.entries(params)) {
    const rendered = value === null || value === undefined ? '' : String(value);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\\\{${escapedKey}\\\\}`, 'g'), rendered);
  }

  return result;
}

