import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Caveat } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ToastContainer } from "@/components/ui/Toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Serif éditoriale — réservée aux hero titles et display marketing.
// C'est ce qui fait basculer du "tech" au "studio créatif".
const instrumentSerif = Instrument_Serif({
  variable: "--font-display-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

// Signature handmade (style Excalidraw) — pour les accents personnalité :
// logo, badges "Astuce", eyebrows décoratifs, légendes. JAMAIS en body
// ni en UI fonctionnelle. C'est ce qui signe l'agence dans l'app sans
// rompre l'épuré tech du reste.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TemplateGen Immo",
  description: "Générateur de visuels immobiliers conformes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${caveat.variable}`}>
      <body suppressHydrationWarning className="antialiased bg-gray-50 text-gray-900 min-h-screen font-sans">
        <SessionProvider>
          {children}
          <ToastContainer />
        </SessionProvider>
      </body>
    </html>
  );
}
