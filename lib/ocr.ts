// OCR / text recognition for uploaded documents.
//
// Two selectable engines:
//   • "openai"    — OpenAI vision (gpt-4o-mini). Best quality; image is sent to the API.
//   • "tesseract" — Tesseract.js, fully local/in-process. Nothing leaves the box (on-prem).
//
// PDFs: if the file has a real text layer we extract it directly (no OCR needed);
// if it is a scanned/image-only PDF we rasterize each page and OCR it with the chosen engine.

export type OcrEngine = "openai" | "tesseract";

export type RecognizeResult = { text: string; engine: string };
export type ExtractResult = RecognizeResult & { mode: string; pages: number };

const MAX_PDF_PAGES = 10; // cap for the demo

export async function recognizeImage(
  buf: Buffer,
  mimeSub: string,
  engine: OcrEngine
): Promise<RecognizeResult> {
  if (engine === "tesseract") return recognizeTesseract(buf);
  const dataUrl = `data:image/${mimeSub};base64,${buf.toString("base64")}`;
  return recognizeOpenAI(dataUrl);
}

async function recognizeOpenAI(dataUrl: string): Promise<RecognizeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const { default: OpenAI } = await import("openai");
  const model = process.env.OCR_MODEL ?? "gpt-4o-mini";
  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are an OCR engine. Transcribe ALL text from the document image verbatim, " +
          "preserving structure (headings, clause numbers, line breaks). " +
          "Output plain text only — no commentary, no markdown fences.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this scanned contract page." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return {
    text: (res.choices[0]?.message?.content ?? "").trim(),
    engine: `OpenAI vision (${model})`,
  };
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
