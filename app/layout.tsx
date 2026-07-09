import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contract Intelligence — Northwind Logistics (demo)",
  description: "RAG over real contracts · Next.js + LlamaIndex.TS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
