import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-arabic", display: "swap" });
const code = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "Muhammad C++ Studio",
  description: "استوديو C++ عربي في المتصفح: اكتب، ابنِ ملف EXE حقيقياً، وشغّله من أي جهاز.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#08100c",
};

// Apply the saved theme before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("mcs-theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${arabic.variable} ${code.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
