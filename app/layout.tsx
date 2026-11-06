import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: "KRIVO · Painel de métricas",
  description: "Métricas do Google Analytics 4 da KRIVO e dos clientes.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${outfit.variable} min-h-dvh antialiased`}>{children}</body>
    </html>
  );
}
