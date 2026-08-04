import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basalt Review",
  description: "Send a document. Get a decision. Keep the record.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter is loaded as a stylesheet link rather than next/font so the
            production build has no build-time network dependency; the system
            sans is the fallback if it fails to load. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
