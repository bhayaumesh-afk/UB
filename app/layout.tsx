import type { Metadata } from "next";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "PriceScout";

export const metadata: Metadata = {
  title: `${appName} — find the best price`,
  description: "Upload a photo, type a product name, or describe an item to compare prices across stores.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-slate-900 antialiased">{children}</body>
    </html>
  );
}
