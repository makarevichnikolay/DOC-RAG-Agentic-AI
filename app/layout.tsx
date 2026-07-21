import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Contract Intelligence — Demo",
  description:
    "Contract / Document Intelligence demo — real RAG (Next.js + LlamaIndex.TS) with mock login, roles and per-client isolation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
