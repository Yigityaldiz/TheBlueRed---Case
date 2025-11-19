import fs from "fs/promises";
import path from "path";
import * as pdfParseModule from "pdf-parse";
import { config } from "dotenv";
import { SUTMatch } from "./types";

config();

const SUT_PATH = path.resolve(__dirname, "../data/SUT.pdf");
let sutTextCache: string | null = null;

async function loadSUTText(): Promise<string> {
  if (sutTextCache) return sutTextCache;
  try {
    const buffer = await fs.readFile(SUT_PATH);
    const PDFParse = (pdfParseModule as any).PDFParse;
    if (!PDFParse) {
      throw new Error("PDFParse constructor not found in pdf-parse module.");
    }
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    sutTextCache = normalizeText(parsed.text || "");
    return sutTextCache;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Unable to load SUT.pdf from ${SUT_PATH}: ${message}`);
  }
}

function normalizeText(text: string): string {
  return normalizeForSearch(text);
}

function buildLocationHint(idx: number, total: number): string {
  if (!total) return "Location unknown";
  const pct = Math.round((idx / total) * 100);
  return `Approx. position ${pct}% of SUT`;
}

function findMatches(normalizedText: string, keyword: string): SUTMatch[] {
  const needle = normalizeForSearch(keyword);
  if (!needle) return [];
  const matches: SUTMatch[] = [];
  let startIndex = 0;
  const window = 1000;

  while (startIndex < normalizedText.length) {
    const hit = normalizedText.indexOf(needle, startIndex);
    if (hit === -1) break;
    const sliceStart = Math.max(0, hit - window);
    const sliceEnd = Math.min(normalizedText.length, hit + needle.length + window);
    const matchText = normalizedText.slice(sliceStart, sliceEnd);
    matches.push({
      matchText,
      locationHint: buildLocationHint(hit, normalizedText.length),
    });
    startIndex = hit + needle.length;
    if (matches.length >= 5) break; // guard against runaway matches
  }
  return matches;
}

export async function findByMedicineName(drugName: string): Promise<SUTMatch[]> {
  const text = await loadSUTText();
  const cleaned = normalizeForSearch(drugName);
  if (!cleaned) return [];
  return findMatches(text, cleaned);
}

export async function findByKeyword(keyword: string): Promise<SUTMatch[]> {
  const text = await loadSUTText();
  return findMatches(text, keyword);
}

export async function ensureSUTLoaded(): Promise<void> {
  await loadSUTText();
}

function normalizeForSearch(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
