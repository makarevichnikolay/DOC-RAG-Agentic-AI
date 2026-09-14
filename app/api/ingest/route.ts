import { NextRequest, NextResponse } from "next/server";
import { recognizeImage, extractFromPdf, type OcrEngine } from "@/lib/ocr";
import { ingestDocument } from "@/lib/rag";
import { deriveFlags } from "@/lib/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp"];
const TEXT_EXT = ["txt", "md"];

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const clientId = String(form.get("clientId") || "");
    const engine: OcrEngine =
      String(form.get("engine") || "cloud") === "tesseract" ? "tesseract" : "cloud";
    const file = form.get("file");

    if (!clientId) {
      return NextResponse.json({ error: "Missing clientId." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 15 MB)." }, { status: 400 });
    }

    const name = file.name || "upload";
    const ext = (name.split(".").pop() || "").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());

    let text = "";
    let engineLabel = "";
    let mode = "";

    if (IMAGE_EXT.includes(ext)) {
      const mimeSub = ext === "jpg" ? "jpeg" : ext;
      const out = await recognizeImage(buf, mimeSub, engine);
      text = out.text;
      engineLabel = out.engine;
      mode = "image OCR";
    } else if (ext === "pdf") {
      const out = await extractFromPdf(buf, engine);
      text = out.text;
      engineLabel = out.engine;
      mode = out.mode;
    } else if (TEXT_EXT.includes(ext)) {
      text = buf.toString("utf-8");
      engineLabel = "text file (no OCR needed)";
      mode = "text";
    } else {
      return NextResponse.json(
        {
          error:
            "Unsupported file. Upload a scanned page (PNG/JPG/WEBP), a PDF, or a .txt file.",
        },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be recognized in the file." },
        { status: 422 }
      );
    }

    const result = await ingestDocument(clientId, name, text);
    // Analyze the recognized text → derive risk/deadline flags for this document.
    const flags = deriveFlags(name, result.title, text);
    return NextResponse.json({ ...result, engine: engineLabel, mode, flags });
  } catch (err: any) {
    console.error("[/api/ingest]", err);
    return NextResponse.json(
      { error: err?.message ?? "Ingest failed" },
      { status: 500 }
    );
  }
}
