import { ParsedDrugLine, ParsedReportMeta } from "./types";

const ICD_REGEX = /\b[A-TV-Z]\d{2}(?:\.\d+)?\b/gi;

const BRANCH_KEYWORDS: Record<string, string[]> = {
  "kalp ve damar cerrahisi": ["kalp ve damar", "kvc", "damar cerrah"],
  "enfeksiyon hastalıkları ve klinik mikrobiyoloji": ["enfeksiyon", "mikrobiyoloji"],
  "iç hastalıkları": ["iç hastalık", "dahiliye"],
  "gastroenteroloji": ["gastroenteroloji", "gastr"],
  "romatoloji": ["romatolog", "romatoloji"],
  "nefroloji": ["nefroloji", "nefro"],
  "endokrinoloji": ["endokrin", "endokrinoloji"],
  "kulak burun boğaz": ["kbb", "kulak burun boğaz"],
};

const FORM_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "ağızdan katı", label: "Ağızdan Katı" },
  { keyword: "agizdan kati", label: "Ağızdan Katı" },
  { keyword: "ağızdan kat", label: "Ağızdan Katı" },
  { keyword: "agizdan kat", label: "Ağızdan Katı" },
  { keyword: "ağızdan", label: "Ağızdan" },
  { keyword: "agizdan", label: "Ağızdan" },
  { keyword: "oral", label: "Oral" },
  { keyword: "iv", label: "IV" },
  { keyword: "intravenöz", label: "IV" },
  { keyword: "intravenoz", label: "IV" },
  { keyword: "enjektabl", label: "Enjektabl" },
  { keyword: "subkutan", label: "SC" },
  { keyword: "sc", label: "SC" },
  { keyword: "tablet", label: "Tablet" },
  { keyword: "kapsül", label: "Kapsül" },
  { keyword: "kapsul", label: "Kapsül" },
  { keyword: "katı", label: "Katı" },
  { keyword: "kati", label: "Katı" },
];

const DRUG_LINE_HINT_REGEX = /(mg|mcg|iu|ml|miligram|gram|günde|tablet|kapsül|kapsul|ampul|sgk)/i;
const DOSE_REGEX = /(\d+\s*x\s*[0-9]+[.,]?[0-9]*\s*(?:mg|mcg|iu|ml|miligram|gram|g|adet))/i;
const FREQUENCY_REGEX = /(günde\s*[0-9x\.,\s]+)/i;

export function parseICDCodes(text: string): string[] {
  const matches = text.match(ICD_REGEX);
  if (!matches) return [];
  const unique = Array.from(new Set(matches.map((m) => m.toUpperCase())));
  return unique;
}

export function parseDoctorBranch(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [branch, tokens] of Object.entries(BRANCH_KEYWORDS)) {
    if (tokens.some((token) => lower.includes(token))) {
      return capitalize(branch);
    }
  }
  return undefined;
}

function capitalize(line: string): string {
  return line
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function parseDrugLines(text: string): ParsedDrugLine[] {
  const lines = text.split(/\r?\n/);
  const tableLines = extractDrugTableLines(lines);
  if (tableLines.length) {
    const tableRows = parseMarkdownTableRows(tableLines);
    if (tableRows.length) {
      const columnCount = Math.max(...tableRows.map((row) => row.length));
      if (columnCount <= 2) {
        const single = buildDrugFromKeyValue(tableRows);
        if (single) {
          return [single];
        }
      } else {
        const parsed = buildDrugsFromGrid(tableRows);
        if (parsed.length) {
          return dedupeDrugs(parsed);
        }
      }
    }
  }

  return dedupeDrugs(fallbackDrugParse(text));
}

function extractDrugTableLines(lines: string[]): string[] {
  const idx = lines.findIndex((line) =>
    line.toLowerCase().includes("rapor etkin madde bilgileri")
  );
  if (idx === -1) return [];

  const collected: string[] = [];
  let started = false;

  for (let i = idx + 1; i < lines.length; i++) {
    const current = lines[i];
    const trimmed = current.trim();
    if (!started) {
      if (!trimmed) continue;
      if (!trimmed.startsWith("|")) {
        if (/^#{2,}/.test(trimmed)) break;
        continue;
      }
      started = true;
      collected.push(current);
      continue;
    }

    if (!trimmed || !trimmed.startsWith("|")) break;
    const normalized = trimmed.toLowerCase();
    if (
      normalized.includes("rapor") &&
      normalized.includes("bilgi") &&
      collected.length
    ) {
      break;
    }
    collected.push(current);
  }

  return collected;
}

function parseMarkdownTableRows(lines: string[]): string[][] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\|/, "").replace(/\|$/, ""))
    .map((line) =>
      line
        .split("|")
        .map((cell) => cleanCell(cell))
        .filter((cell) => cell.length || line.includes("|"))
    )
    .filter((row) => row.some((cell) => cell.length))
    .filter((row) => !isDividerRow(row));
}

function cleanCell(cell: string): string {
  return cell.replace(/\*\*/g, "").replace(/__+/g, "").trim();
}

function isDividerRow(row: string[]): boolean {
  return row.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s+/g, "")));
}

function buildDrugsFromGrid(rows: string[][]): ParsedDrugLine[] {
  if (rows.length <= 1) return [];
  const header = rows[0].map((cell) => normalizeKey(cell));
  const dataRows = rows.slice(1);
  const nameIdx = findColumnIndex(header, ["adı", "adi", "ad", "ilac", "etkin madde"]);
  const codeIdx = findColumnIndex(header, ["kodu", "kod"]);
  const formIdx = findColumnIndex(header, ["form"]);
  const regimenIdx = findColumnIndex(header, ["tedavi", "şema", "sema"]);

  const result: ParsedDrugLine[] = [];
  for (const row of dataRows) {
    const rowText = row.join(" | ");
    const nameCell = cellValue(row, nameIdx);
    const codeCell = cellValue(row, codeIdx);
    const regimen = cellValue(row, regimenIdx);
    const baseFormText = cellValue(row, formIdx) || regimen;
    const form = extractForm(baseFormText);
    const { dose, frequency } = parseRegimenInfo(regimen);
    const drugName = normalizeDrugName(nameCell || deriveDrugName(codeCell) || codeCell);
    if (!drugName) continue;

    result.push({
      rawLine: rowText,
      drugName,
      form,
      dose,
      frequency,
    });
  }
  return result;
}

function buildDrugFromKeyValue(rows: string[][]): ParsedDrugLine | undefined {
  const entries = new Map<string, string>();
  for (const row of rows) {
    if (row.length < 2) continue;
    const key = normalizeKey(row[0]);
    const value = row[1]?.trim();
    if (!key || !value) continue;
    if (key.includes("rapor") && key.includes("bilgi")) continue;
    entries.set(key, value);
  }
  if (!entries.size) return undefined;

  const name =
    entries.get("adı") ||
    entries.get("adi") ||
    entries.get("ad") ||
    entries.get("etkin madde") ||
    entries.get("ilac");
  const codeValue = entries.get("kodu");
  const regimen =
    entries.get("tedavi şema") ||
    entries.get("tedavi şeması") ||
    entries.get("tedavi semasi") ||
    entries.get("tedavi sema");
  const form = extractForm(entries.get("form") || regimen);
  const { dose, frequency } = parseRegimenInfo(regimen);
  const drugName = normalizeDrugName(name || deriveDrugName(codeValue) || codeValue);
  if (!drugName) return undefined;

  return {
    rawLine: Array.from(entries.entries())
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | "),
    drugName,
    form,
    dose,
    frequency,
  };
}

function parseRegimenInfo(text?: string): { dose?: string; frequency?: string } {
  if (!text) return {};
  const doseMatch = text.match(DOSE_REGEX);
  const freqMatch = text.match(FREQUENCY_REGEX);
  return {
    dose: doseMatch ? normalizeSpacing(doseMatch[1]) : undefined,
    frequency: freqMatch ? normalizeSpacing(freqMatch[1]) : undefined,
  };
}

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9ığüşöç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDrugName(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.toUpperCase();
}

function deriveDrugName(text?: string): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && /^sgk\w*/i.test(parts[0])) {
    return parts.slice(1).join(" ");
  }
  return trimmed;
}

function cellValue(row: string[], idx: number): string | undefined {
  if (idx < 0 || idx >= row.length) return undefined;
  const value = row[idx]?.trim();
  return value || undefined;
}

function findColumnIndex(header: string[], keywords: string[]): number {
  for (const keyword of keywords) {
    const idx = header.findIndex((cell) => cell.includes(keyword));
    if (idx !== -1) return idx;
  }
  return -1;
}

function extractForm(line?: string): string | undefined {
  if (!line) return undefined;
  const lower = line.toLowerCase();
  for (const entry of FORM_KEYWORDS) {
    if (lower.includes(entry.keyword)) return entry.label;
  }
  return undefined;
}

function fallbackDrugParse(text: string): ParsedDrugLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((line) => line && DRUG_LINE_HINT_REGEX.test(line));

  const candidates: ParsedDrugLine[] = [];
  for (const line of lines) {
    const drugMatch = /(?:sgk\w*\s+)?([a-zçğıöşü0-9\+\-\/\s]+?)(?:\s{2,}|\s+-\s+|\s\|\s|$)/i.exec(line);
    if (!drugMatch) continue;
    const drugNameRaw = drugMatch[1].trim();
    if (!drugNameRaw || drugNameRaw.length < 3) continue;

    const cleanedName = drugNameRaw.replace(/^\d+\.?/g, "").trim();
    const doseMatch = line.match(DOSE_REGEX);
    const freqMatch = line.match(FREQUENCY_REGEX);
    const durationMatch = line.match(/(\d+)\s*gün/i);

    candidates.push({
      rawLine: line,
      drugName: cleanedName.toUpperCase(),
      form: extractForm(line),
      dose: doseMatch ? normalizeSpacing(doseMatch[1]) : undefined,
      frequency: freqMatch ? normalizeSpacing(freqMatch[1]) : undefined,
      durationDays: durationMatch ? parseInt(durationMatch[1], 10) : undefined,
    });
  }

  return candidates;
}

function dedupeDrugs(drugs: ParsedDrugLine[]): ParsedDrugLine[] {
  const seen = new Set<string>();
  const result: ParsedDrugLine[] = [];
  for (const drug of drugs) {
    const key = drug.drugName;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(drug);
  }
  return result;
}

export function parseReport(ocrText: string): ParsedReportMeta {
  return {
    icdCodes: parseICDCodes(ocrText),
    doctorBranch: parseDoctorBranch(ocrText),
    drugLines: parseDrugLines(ocrText),
  };
}
