import { createUploadedFileObjectUrl } from '../api';

function normalizeSingleFileId(value: unknown) {
  const normalized = String(value || '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

export function normalizeUploadedFileIds(
  value: unknown,
  legacyValue?: unknown,
): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  const append = (input: unknown) => {
    if (Array.isArray(input)) {
      input.forEach(append);
      return;
    }

    const normalized = normalizeSingleFileId(input);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    collected.push(normalized);
  };

  append(legacyValue);
  append(value);

  return collected;
}

export async function loadUploadedFileObjectUrls(
  value: unknown,
  legacyValue?: unknown,
) {
  const ids = normalizeUploadedFileIds(value, legacyValue);
  return Promise.all(ids.map((id) => createUploadedFileObjectUrl(id)));
}

export function revokeObjectUrls(urls: Array<string | null | undefined>) {
  urls.forEach((url) => {
    if (String(url || '').startsWith('blob:')) {
      URL.revokeObjectURL(String(url));
    }
  });
}
