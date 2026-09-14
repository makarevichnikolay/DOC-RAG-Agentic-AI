import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getClientConfig } from "@/lib/clients";
import { getUploadedDoc } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the raw text of a single contract, scoped to the client's own directories.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";

  const cfg = getClientConfig(clientId);
  if (!cfg) {
    return NextResponse.json({ error: "Unknown client." }, { status: 400 });
  }
  // Path traversal guard: a bare file name only.
  if (!file || file !== path.basename(file)) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }

  // Uploaded (OCR'd) documents are held by the vector store, not on disk.
  const uploaded = await getUploadedDoc(clientId, file);
  if (uploaded) {
    return NextResponse.json({ file, text: uploaded.text, uploaded: true });
  }

  if (!file.toLowerCase().endsWith(".txt")) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }

  for (const dir of [cfg.contractsDir, cfg.extraDir]) {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      const text = fs.readFileSync(full, "utf-8");
      return NextResponse.json({ file, text });
    }
  }
  return NextResponse.json(
    { error: "Document not found for this client." },
    { status: 404 }
  );
}
