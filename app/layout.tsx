import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One display face, loaded as a variable font and used only for headings and the
// wordmark. Body copy stays on the system stack so the app shell renders instantly.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

const DESCRIPTION =
  "Open-source, self-hostable AI app builder. Describe an app, watch it run live in a Firecracker microVM, then fork the running app and its Postgres into parallel variations and keep the one you like.";

export const metadata: Metadata = {
  metadataBase: new URL("https://github.com/pandastack-io/riff"),
  title: { default: "Riff — prompt to a running app, then fork it", template: "%s · Riff" },
  description: DESCRIPTION,
  keywords: ["AI app builder", "open source", "self-hosted", "Firecracker", "microVM", "Lovable alternative", "v0 alternative", "bolt.new alternative", "PandaStack"],
  openGraph: {
    type: "website", siteName: "Riff",
    title: "Riff — prompt to a running app, then fork it",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Riff — prompt to a running app, then fork it", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
