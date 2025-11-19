declare module "pdf-parse" {
  interface PDFInfo {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }

  interface PDFParseResult {
    numpages: number;
    numrender: number;
    info: PDFInfo;
    metadata?: unknown;
    version?: string;
    text: string;
  }

  function pdf(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PDFParseResult>;
  export = pdf;
}
