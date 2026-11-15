import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-sans"
});

const display = IBM_Plex_Serif({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600"],
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: "Борисхоф Digital Control",
  description: "Дашборд digital-направления автомобильного холдинга: Директ, Метрика, Calltouch"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${sans.variable} ${display.variable} font-sans antialiased`}>
        <Suspense fallback={<div className="p-8 text-sm text-mute">Загрузка…</div>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
