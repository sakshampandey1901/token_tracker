import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Token Tracker — live LLM usage dashboard",
  description:
    "Free, open-source, real-time tracker for your LLM token usage across providers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
