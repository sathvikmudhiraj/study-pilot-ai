import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/frontend/components/ui/Toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://studypilot.ai"),
  title: {
    default: "StudyPilot AI",
    template: "%s - StudyPilot AI",
  },
  description: "An AI-powered learning workspace for students.",
  applicationName: "StudyPilot AI",
  authors: [{ name: "StudyPilot AI" }],
  openGraph: {
    title: "StudyPilot AI",
    description: "An AI-powered learning workspace for students.",
    siteName: "StudyPilot AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StudyPilot AI",
    description: "An AI-powered learning workspace for students.",
  },
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#070b14] text-slate-100">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
