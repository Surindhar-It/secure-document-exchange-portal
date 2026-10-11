import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ThemeToggle from "@/components/ThemeToggle";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FortressShare | Secure Cryptographic File Exchange",
  description: "Enterprise-grade Zero-Knowledge end-to-end encrypted file sharing portal with ephemeral link control, blockchain audit trail, and AI-powered threat detection.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (_) {}
              })()
            `,
          }}
        />
      </head>
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} min-h-full flex flex-col bg-cyber-dark text-text-primary font-sans tech-grid`}
      >
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
