import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quick Filler — Transcrição de holerites e cartões de ponto",
  description: "Envie um PDF, revise a transcrição e baixe a planilha.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
