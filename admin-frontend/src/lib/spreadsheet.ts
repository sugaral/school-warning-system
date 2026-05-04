import * as XLSX from 'xlsx';

export type ParsedSpreadsheet = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

const parseCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

export const parseCsvText = (csvContent: string): ParsedSpreadsheet => {
  const normalized = csvContent
    .replace(/^\ufeff/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error('表格文件至少需要表头和一行数据');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (!headers.length || headers.every((header) => !header)) {
    throw new Error('表头不能为空');
  }

  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] ?? '');
    });
    return row;
  });

  return { headers, rows };
};

export const parseWorksheetBuffer = (buffer: ArrayBuffer): ParsedSpreadsheet => {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Excel 文件中没有可读取的工作表');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rangeRef = sheet['!ref'];
  if (!rangeRef) {
    throw new Error('Excel 文件中没有可读取的数据区域');
  }

  const range = XLSX.utils.decode_range(rangeRef);
  const matrix: string[][] = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];

    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[cellAddress];
      const displayValue =
        cell && cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== ''
          ? cell.w
          : cell?.v ?? '';
      row.push(String(displayValue ?? '').trim());
    }

    matrix.push(row);
  }

  const cleaned = matrix.filter((row) => row.some((cell) => cell !== ''));

  if (cleaned.length < 2) {
    throw new Error('Excel 文件至少需要表头和一行数据');
  }

  const headers = cleaned[0];
  if (!headers.length || headers.every((header) => !header)) {
    throw new Error('表头不能为空');
  }

  const rows = cleaned.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] ?? '');
    });
    return row;
  });

  return { headers, rows };
};

export const parseSpreadsheetFile = async (file: File): Promise<ParsedSpreadsheet> => {
  const fileName = String(file.name || '').toLowerCase();
  if (fileName.endsWith('.csv')) {
    const text = await file.text();
    return parseCsvText(text);
  }

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    return parseWorksheetBuffer(buffer);
  }

  throw new Error('仅支持 CSV、XLSX、XLS 文件');
};
