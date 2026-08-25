import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/frontend/components/ui/Toaster";

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
      className="h-full antialiased"
    >
      <body className="min-h-full bg-[#070b14] text-slate-100">
        <Script
          id="ignore-extension-errors"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function isExtensionError(event) {
                  var filename = event && event.filename ? String(event.filename) : "";
                  var message = event && event.message ? String(event.message) : "";
                  var errorStack = event && event.error && event.error.stack ? String(event.error.stack) : "";
                  return filename.indexOf("chrome-extension://") === 0 ||
                    errorStack.indexOf("chrome-extension://") !== -1 ||
                    (message.indexOf("Minified React error #299") !== -1 &&
                      errorStack.indexOf("embed_script.js") !== -1);
                }

                window.addEventListener("error", function (event) {
                  if (!isExtensionError(event)) return;
                  event.preventDefault();
                  event.stopImmediatePropagation();
                }, true);

                window.addEventListener("unhandledrejection", function (event) {
                  var reason = event && event.reason;
                  var stack = reason && reason.stack ? String(reason.stack) : "";
                  var message = reason && reason.message ? String(reason.message) : "";
                  if (stack.indexOf("chrome-extension://") === -1 &&
                    message.indexOf("chrome-extension://") === -1) return;
                  event.preventDefault();
                  event.stopImmediatePropagation();
                }, true);
              })();
            `,
          }}
        />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
