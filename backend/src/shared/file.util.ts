import { BadRequestException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface SerializedFileRecord {
  id: string;
  file_name: string;
  file_key: string;
  file_size: string;
  mime_type: string;
  source: string;
  url: string;
  created_at: Date;
}

function normalizeSingleFileId(value: unknown) {
  const normalized = String(value || '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

export function normalizeFileIdList(
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

export function parseOptionalFileIds(
  value: unknown,
  fieldName = '图片文件',
): bigint[] {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && String(value).trim() === '')
  ) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  const collected: bigint[] = [];
  const seen = new Set<string>();

  for (const item of values) {
    const normalized = String(item || '').trim();
    if (!normalized) {
      continue;
    }

    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException(`${fieldName} 无效`);
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    collected.push(BigInt(normalized));
  }

  return collected;
}

export function buildFilePublicUrl(fileKey?: string | null) {
  const normalized = String(fileKey || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  return normalized ? `/uploads/${normalized}` : '';
}

export function serializeFileRecord(file: any): SerializedFileRecord | null {
  if (!file) {
    return null;
  }

  return {
    id: file.id.toString(),
    file_name: String(file.file_name || ''),
    file_key: String(file.file_key || ''),
    file_size: file.file_size?.toString?.() || '0',
    mime_type: String(file.mime_type || ''),
    source: String(file.source || 'upload'),
    url: buildFilePublicUrl(file.file_key),
    created_at: file.created_at,
  };
}

export async function buildFileSummaryMap(
  prisma: PrismaService,
  fileIds: Array<bigint | null | undefined>,
) {
  const normalizedIds = Array.from(
    new Map(
      fileIds
        .filter((item): item is bigint => Boolean(item))
        .map((item) => [item.toString(), item]),
    ).values(),
  );

  if (normalizedIds.length === 0) {
    return new Map<string, SerializedFileRecord>();
  }

  const files = await prisma.files.findMany({
    where: { id: { in: normalizedIds } },
    orderBy: { created_at: 'desc' },
  });

  return new Map(
    files
      .map((item) => [item.id.toString(), serializeFileRecord(item)])
      .filter((entry): entry is [string, SerializedFileRecord] => Boolean(entry[1])),
  );
}
