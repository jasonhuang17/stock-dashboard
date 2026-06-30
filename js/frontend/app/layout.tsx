import type { Metadata } from "next";
import "./globals.css";
import { ThemeInitializer } from "./components/ThemeInitializer";

export const metadata: Metadata = {
  title: "◈ Stock Dashboard",
  description: "美股與台股即時儀表板",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body style={{ minHeight: "100vh" }}>
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
