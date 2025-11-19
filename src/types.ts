export interface SUTMatch {
  matchText: string;
  locationHint: string;
}

export interface ParsedDrugLine {
  rawLine: string;
  drugName: string;
  form?: string;
  dose?: string;
  frequency?: string;
  durationDays?: number;
}

export interface ParsedReportMeta {
  icdCodes?: string[];
  doctorBranch?: string;
  drugLines?: ParsedDrugLine[];
}

export interface DrugDecision {
  drug_name: string;
  payable: boolean;
  reason: string;
  missing_criteria: string[];
}

export interface ReportDecision {
  report_id: string;
  items: DrugDecision[];
  global_notes: string;
}

export interface JudgeReportInput {
  reportId: string;
  ocrText: string;
  sutMatchesByDrug: Record<string, SUTMatch[]>;
  parsedMeta?: {
    icdCodes?: string[];
    doctorBranch?: string;
  };
}

export class OCRRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OCRRequestError";
  }
}
