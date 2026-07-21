import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContentCourier — Sitecore Content Transfer, Delivered",
  description:
    "Move items and their descendants between SitecoreAI environments in one guided, admin-only workflow — with path preflight, configurable merge strategies, and live progress you can watch end to end.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
