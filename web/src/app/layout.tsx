import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ToastContainer } from "@/components/ui/Toast";

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
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body suppressHydrationWarning className="antialiased bg-gray-50 text-gray-900 min-h-screen font-sans">
        <SessionProvider>
          {children}
          <ToastContainer />
        </SessionProvider>
      </body>
    </html>
  );
}
