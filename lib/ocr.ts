// OCR / text recognition for uploaded documents.
//
// Two selectable engines:
//   • "cloud"     — the vision model of whichever LLM_PROVIDER is configured
//                   (OpenAI gpt-4o-mini, or Claude). Best quality; the image is
//                   sent to that provider's API.
//   • "tesseract" — Tesseract.js, fully local/in-process. Nothing leaves the box (on-prem).
//
// PDFs: if the file has a real text layer we extract it directly (no OCR needed);
// if it is a scanned/image-only PDF we rasterize each page and OCR it with the chosen engine.

import { transcribeImage } from "./providers";

// "openai" is kept as an accepted alias so existing UI/query values keep working;
// it now means "the configured cloud provider", which may be Anthropic.
export type OcrEngine = "cloud" | "openai" | "tesseract";

export type RecognizeResult = { text: string; engine: string };
export type ExtractResult = RecognizeResult & { mode: string; pages: number };

const MAX_PDF_PAGES = 10; // cap for the demo

export async function recognizeImage(
  buf: Buffer,
  mimeSub: string,
  engine: OcrEngine
): Promise<RecognizeResult> {
  if (engine === "tesseract") return recognizeTesseract(buf);
  // Cloud OCR follows LLM_PROVIDER, so switching the app to Claude switches the
  // whole pipeline rather than leaving OCR on OpenAI.
  return transcribeImage(buf, mimeSub);
}

async function recognizeTesseract(buf: Buffer): Promise<RecognizeResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buf);
    return { text: (data.text ?? "").trim(), engine: "Tesseract (local, eng)" };
  } finally {
    await worker.terminate();
  }
}

// PDF: text-layer extraction first; fall back to page rasterization + OCR for scans.
export async function extractFromPdf(
  buf: Buffer,
  engine: OcrEngine
): Promise<ExtractResult> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const extracted = await extractText(proxy, { mergePages: true });
  const merged = Array.isArray(extracted.text)
    ? extracted.text.join("\n")
    : extracted.text;

  if (merged.trim().length >= 200) {
    return {
      text: merged.trim(),
      engine: "PDF text layer (no OCR needed)",
      mode: "text-layer",
      pages: extracted.totalPages,
    };
  }

  // Scanned / image-only PDF → rasterize pages and OCR them.
  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(buf, { scale: 2 });
  const total = Math.min(doc.length, MAX_PDF_PAGES);
  const parts: string[] = [];
  let engineLabel = "";
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const r = await recognizeImage(page as Buffer, "png", engine);
    parts.push(r.text);
    engineLabel = r.engine;
  }
  return {
    text: parts.join("\n\n").trim(),
    engine: `${engineLabel} · rasterized PDF (${total} pg)`,
    mode: "ocr",
    pages: total,
  };
}
