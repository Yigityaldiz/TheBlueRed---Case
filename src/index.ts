import fs from "fs/promises";
import path from "path";
import { config } from "dotenv";
import { runOCR } from "./ocr";
import { ensureSUTLoaded, findByMedicineName } from "./sut_parser";
import { judgeReport } from "./llm";
import { parseReport } from "./parser";
import { ReportDecision } from "./types";

config();

async function main(): Promise<void> {
  const inputDir = process.argv[2] || "./inputs";
  const resolvedInput = path.resolve(inputDir);
  const outputsDir = path.resolve("./outputs");
  await fs.mkdir(outputsDir, { recursive: true });

  await ensureSUTLoaded().catch((err) => {
    console.error(`SUT.pdf yüklenemedi: ${(err as Error).message}`);
    process.exit(1);
  });

  const files = await fs.readdir(resolvedInput).catch(() => {
    console.error(`Girdi klasörü bulunamadı: ${resolvedInput}`);
    process.exit(1);
  });

  const imageFiles = files.filter((f) => isImageFile(f));
  if (!imageFiles.length) {
    console.log(`Görüntü dosyası bulunamadı: ${resolvedInput}`);
    return;
  }

  const reportDecisions: ReportDecision[] = [];
  const reportMarkdownParts: string[] = [];

  for (const file of imageFiles) {
    const filePath = path.join(resolvedInput, file);
    console.log(`İşleniyor: ${filePath}...`);
    try {
      console.log("  -> OCR başlatılıyor (OpenAI Vision)...");
      const ocrText = await runOCR(filePath);
      console.log("  -> OCR tamamlandı, metin alındı.");
      const parsed = parseReport(ocrText);
      console.log("  -> OCR metni ayrıştırıldı (ICD/branş/ilaçlar).");

      const drugs = parsed.drugLines?.map((d) => d.drugName) || [];
      const sutMatchesByDrug: Record<string, Awaited<ReturnType<typeof findByMedicineName>>> = {};
      console.log(`  -> ${drugs.length || 0} ilaç için SUT araması yapılıyor...`);
      for (const drug of drugs) {
        sutMatchesByDrug[drug] = await findByMedicineName(drug);
      }
      console.log("  -> SUT bağlamları hazır.");

      console.log("  -> DeepSeek değerlendirmesi bekleniyor...");
      const decision = await judgeReport({
        reportId: file,
        ocrText,
        sutMatchesByDrug,
        parsedMeta: {
          icdCodes: parsed.icdCodes,
          doctorBranch: parsed.doctorBranch,
        },
      });

      reportDecisions.push(decision);
      reportMarkdownParts.push(renderMarkdownForReport(file, parsed, decision));
      console.log("  -> Rapor kararı işlendi ve çıktılara eklendi.\n");
    } catch (err) {
      console.error(`İşlenirken hata oluştu (${file}): ${(err as Error).message}`);
    }
  }

  await fs.writeFile(path.join(outputsDir, "raw_decisions.json"), JSON.stringify(reportDecisions, null, 2), "utf8");
  await fs.writeFile(path.join(outputsDir, "report.md"), reportMarkdownParts.join("\n\n"), "utf8");

  console.log(`Tamamlandı. Sonuçlar ${outputsDir}/report.md ve raw_decisions.json dosyalarına yazıldı.`);
}

function isImageFile(file: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(file);
}

function renderMarkdownForReport(
  file: string,
  parsed: ReturnType<typeof parseReport>,
  decision: ReportDecision
): string {
  const icds = parsed.icdCodes?.join(", ") || "N/A";
  const branch = parsed.doctorBranch || "N/A";
  const rows = decision.items
    .map(
      (item) =>
        `| ${item.drug_name} | ${item.payable ? "✅" : "❌"} | ${item.reason || ""} |`
    )
    .join("\n");

  return [
    `## ${file}`,
    ``,
    `- ICD codes: ${icds}`,
    `- Doctor branch: ${branch}`,
    ``,
    `| Drug | Payable | Reason |`,
    `| --- | --- | --- |`,
    rows || "| No drugs parsed | - | - |",
    parsed.drugLines?.length
      ? "\nParsed drugs:\n" +
        parsed.drugLines
          .map(
            (d) =>
              `- ${d.drugName} (${d.form || "form N/A"}, ${d.dose || "dose N/A"}, ${d.frequency || "freq N/A"})`
          )
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
