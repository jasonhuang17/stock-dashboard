import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "◈ Stock Dashboard",
  description: "美股與台股即時儀表板",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body style={{ minHeight: "100vh" }}>{children}</body>
    </html>
  );
}
