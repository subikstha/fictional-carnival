import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "./sw-register";
import InstallPWA from "@/components/InstallButton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "Web Push PWA",
  description: "Web Push & PWA application",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Web Push PWA",
  },
  icons: {
    apple: "/icon-512.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <ServiceWorkerRegister />

      <body className="min-h-full flex flex-col">
        {children}
        <InstallPWA />
      </body>
    </html>
  );
}
