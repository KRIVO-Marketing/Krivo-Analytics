import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: "KRIVO · Painel de métricas",
  description: "Métricas do Google Analytics 4 da KRIVO e dos clientes.",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const THEME_INIT = `try{var t=localStorage.getItem("krivo_theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={`${outfit.variable} min-h-dvh antialiased`}>{children}</body>
    </html>
  );
}
