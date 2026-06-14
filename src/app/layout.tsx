import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atbash Playground",
  description: "Live agent playground — contestant chat + admin observer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
