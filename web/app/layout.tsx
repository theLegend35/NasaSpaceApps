import type { Metadata, Viewport } from "next";
import "./nocturne.css";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "SolaraX",
  description: "Find what moves in SPHEREx, and know what it is.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#161826" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}
