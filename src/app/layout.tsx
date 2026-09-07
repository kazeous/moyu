import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "moyu",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "moyu", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.png" },
  referrer: "no-referrer",
  description: "Review Japanese and Chinese dialogue with local evidence.",
};
export const viewport: Viewport = { themeColor: "#235c49" };

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
