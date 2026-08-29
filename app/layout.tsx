import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riff",
  description: "Prompt → a running full-stack app. Then fork it. Self-hosted on PandaStack.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
