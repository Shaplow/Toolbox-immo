import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ToastContainer } from "@/components/ui/Toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
    <html lang="fr">
      <body className={`${geistSans.variable} antialiased bg-gray-50 text-gray-900 min-h-screen`}>
        <SessionProvider>
          {children}
          <ToastContainer />
        </SessionProvider>
      </body>
    </html>
  );
}
