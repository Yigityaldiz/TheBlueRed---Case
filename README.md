# AI-Powered SUT Compliance Checker (MVP)

Node.js + TypeScript CLI that reads Turkish medical report images, finds the relevant SUT (Sağlık Uygulama Tebliği) fragments, and asks DeepSeek V3 to decide whether each prescribed drug is reimbursable.

## Overview
- Vision OCR with OpenAI (default `gpt-4o-mini`) turns every PNG/JPG/JPEG/WEBP file inside `inputs/` into markdown text.
- Lightweight parser extracts ICD codes, doctor branch hints, and drug rows (dose, frequency, form) from the OCR output.
- `pdf-parse` loads `data/SUT.pdf`, normalizes the text, and returns ±1000 character windows that match each drug name.
- DeepSeek V3 receives the OCR text, parsed metadata, and SUT snippets, then answers with strict JSON (in Turkish) summarizing SGK eligibility.

## Requirements
- Node.js 20+ (ts-node based workflow).
- Access tokens for both OpenAI (Vision OCR) and DeepSeek (judgement step).
- `data/SUT.pdf` copy of the regulation, kept alongside the repo.

## Installation
```bash
npm install
```

## Configuration (`.env`)
Create `.env` (copy from `.env.example` if present) and fill in the keys:

```ini
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL= # optional self-hosted proxy
OPENAI_MODEL=gpt-4o-mini

DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com # optional override
DEEPSEEK_MODEL=deepseek-chat
```

## Preparing input data
- Place the latest `SUT.pdf` under `data/SUT.pdf`. First run caches the parsed text in memory.
- Drop one or more report images into `./inputs`. Only files matching `*.png|*.jpg|*.jpeg|*.webp` are processed.
- The CLI accepts an optional path argument if you want to point to another folder (e.g., `npx ts-node src/index.ts ./my-reports`).

## Running the CLI
```bash
# default: scans ./inputs and writes to ./outputs
npx ts-node src/index.ts

# custom directory
npx ts-node src/index.ts ./path/to/images
```

You can also wire this into `npm start` (which calls `ts-node src/index.ts`) and pass the folder as the first argument.

## Outputs
- `outputs/report.md` – markdown report per input file with parsed metadata and payable/denied table.
- `outputs/raw_decisions.json` – raw LLM JSON payload for auditing or downstream automation.

## How it works
1. **OCR** – `src/ocr.ts` streams the image as base64 to OpenAI's vision endpoint and returns markdown/plain text.
2. **Parsing** – `src/parser.ts` scrapes ICD codes, physician branch clues, and drug rows (tables or heuristics).
3. **SUT retrieval** – `src/sut_parser.ts` loads the regulation PDF, normalizes text, and fetches context windows per drug.
4. **Judgement** – `src/llm.ts` packages everything and asks DeepSeek V3 for SGK compliance, enforcing JSON schema rules.
5. **Reporting** – `src/index.ts` writes a human-friendly markdown summary plus the original JSON decisions under `outputs/`.

## Tips
- If no images are detected the CLI exits early; double-check file extensions.
- When DeepSeek returns zero items for a report with drugs, the CLI throws and prints the raw JSON for easier debugging.
- Keep explanations from the LLM short by adjusting the prompt in `src/llm.ts` if pharmacists need more/less detail.
