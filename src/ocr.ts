import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { OCRRequestError } from "./types";
import { config } from "dotenv";
config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL, // opsiyonel
});
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export async function runOCR(imagePath: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new OCRRequestError("OPENAI_API_KEY missing");
  }
  const absolute = path.resolve(imagePath);
  const imageB64 = (await fs.readFile(absolute)).toString("base64");

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Extract all text from the medical report image. Preserve rows/columns as markdown tables where possible. Return plain text/markdown only.",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageB64}` },
          },
        ],
      },
    ],
    temperature: 0,
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new OCRRequestError("Empty OCR response");
  return text;
}
