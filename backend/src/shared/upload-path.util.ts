import { promises as fs } from 'fs';
import { join, resolve } from 'path';

export function normalizeUploadFileKey(fileKey?: string | null) {
  return String(fileKey || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

export function getUploadRootCandidates(baseDir = process.cwd()) {
  const rawCandidates = [
    process.env.UPLOAD_ROOT,
    process.env.UPLOAD_DIR,
    join(baseDir, 'uploads'),
    join(baseDir, 'dist', 'uploads'),
    join(baseDir, '..', 'uploads'),
    join(baseDir, '..', 'backend', 'uploads'),
    join(baseDir, '..', 'backend', 'dist', 'uploads'),
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return Array.from(new Set(rawCandidates.map((item) => resolve(item))));
}

export function getPrimaryUploadRoot(baseDir = process.cwd()) {
  const [firstCandidate] = getUploadRootCandidates(baseDir);
  return firstCandidate || resolve(baseDir, 'uploads');
}

export async function resolveExistingUploadFilePath(
  fileKey?: string | null,
  baseDir = process.cwd(),
) {
  const normalizedKey = normalizeUploadFileKey(fileKey);
  if (!normalizedKey) {
    return null;
  }

  for (const root of getUploadRootCandidates(baseDir)) {
    const absolutePath = join(root, normalizedKey);
    try {
      await fs.access(absolutePath);
      return absolutePath;
    } catch {
      // try next root
    }
  }

  return null;
}
