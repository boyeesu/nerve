import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nerve — Agent Command Center",
  description:
    "One visual command center for every OpenClaw and Hermes agent.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
