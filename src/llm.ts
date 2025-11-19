import { config } from "dotenv";
import OpenAI from "openai";
import { JudgeReportInput, ReportDecision, DrugDecision, SUTMatch } from "./types";

config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

const DECISION_SCHEMA_PROMPT = `
Return strict JSON with the shape:
{
  "report_id": "<string>",
  "items": [
    {
      "drug_name": "<string>",
      "payable": true | false,
      "reason": "<short rationale referencing SUT or missing info>",
      "missing_criteria": ["<string>", "..."]
    }
  ],
  "global_notes": "<optional summary>"
}
Rules:
1. Items array MUST contain one entry for EVERY drug listed under "Drugs to evaluate".
2. If SUT context is missing, infer from general SUT knowledge; if unsure, set payable=false and explain what documentation is missing.
3. "missing_criteria" must always be present. Use [] when drug is payable with no missing items.
4. All free-text fields ("reason", each value inside "missing_criteria", and "global_notes") MUST be written in Turkish.
5. Keep explanations concise and actionable for a pharmacist.`.trim();

function buildContextByDrug(sutMatchesByDrug: Record<string, SUTMatch[]>): string {
  return Object.entries(sutMatchesByDrug)
    .map(([drug, matches]) => {
      const contexts = matches
        .map((m, idx) => `- [${idx + 1}] (${m.locationHint}) ${m.matchText}`)
        .join("\n");
      return `Drug: ${drug}\n${contexts || "- No SUT context found."}`;
    })
    .join("\n\n");
}

function buildUserMessage(input: JudgeReportInput): string {
  const { ocrText, parsedMeta, sutMatchesByDrug } = input;
  const drugList = Object.keys(sutMatchesByDrug);
  const metaLines = [
    parsedMeta?.icdCodes?.length ? `ICD Codes: ${parsedMeta.icdCodes.join(", ")}` : "ICD Codes: N/A",
    parsedMeta?.doctorBranch ? `Doctor Branch: ${parsedMeta.doctorBranch}` : "Doctor Branch: N/A",
    drugList.length ? `Drugs: ${drugList.join(", ")}` : "Drugs: N/A",
  ];
  const drugEvaluationLines = drugList.length
    ? drugList.map((drug) => {
        const matchCount = sutMatchesByDrug[drug]?.length ?? 0;
        return `- ${drug} (SUT matches: ${matchCount})`;
      })
    : ["- None detected in OCR (if this happens, explain why)."];

  return [
    "OCR TEXT:",
    ocrText,
    "",
    "Parsed Meta:",
    metaLines.join("\n"),
    "",
    "Drugs to evaluate:",
    drugEvaluationLines.join("\n"),
    "",
    "SUT CONTEXT BY DRUG:",
    buildContextByDrug(sutMatchesByDrug),
    "",
    "Respond with pure JSON matching the required schema described below.",
    DECISION_SCHEMA_PROMPT,
  ].join("\n");
}

export async function judgeReport(input: JudgeReportInput): Promise<ReportDecision> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is missing in environment.");
  }

  const userContent = buildUserMessage(input);
  const system = `You are a strict medical auditor working for the Turkish Social Security Institution (SGK). You check whether each medical report and its prescribed drugs fully comply with the SUT (Sağlık Uygulama Tebliği) reimbursement rules. All explanations and lists MUST be written in Turkish. Always return valid JSON only. Do not include markdown or commentary.`;

  const completion = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response.");
  }

  return parseDecision(content, input.reportId, Object.keys(input.sutMatchesByDrug));
}

function parseDecision(content: string, reportId: string, expectedDrugs: string[]): ReportDecision {
  try {
    const parsed = JSON.parse(content);
    const rawItems: DrugDecision[] = Array.isArray(parsed.items) ? parsed.items : parsed.drugs || [];
    const normalizedItems = rawItems.map((item) => ({
      drug_name: item.drug_name || "UNKNOWN_DRUG",
      payable: Boolean(item.payable),
      reason: item.reason || "",
      missing_criteria: Array.isArray(item.missing_criteria) ? item.missing_criteria : [],
    }));

    if (!normalizedItems.length && expectedDrugs.length) {
      throw new Error(`LLM returned 0 items even though ${expectedDrugs.length} drugs were requested.`);
    }

    return {
      report_id: parsed.report_id || reportId,
      items: normalizedItems,
      global_notes: parsed.global_notes || "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Unable to parse LLM JSON: ${message}\nRaw content:\n${content}`);
  }
}
