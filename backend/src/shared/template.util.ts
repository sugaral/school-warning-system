export function renderTemplate(template: string, params: Record<string, any> = {}) {
  let result = template;

  for (const [key, value] of Object.entries(params)) {
    const rendered = value === null || value === undefined ? '' : String(value);
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), rendered);
  }

  return result;
}

