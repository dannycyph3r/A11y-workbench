import type { Metadata, Viewport } from "next";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/atkinson-hyperlegible-mono";
import "./globals.css";
import { StoreProvider } from "@/components/store";
import { Shell } from "@/components/shell";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/version";

export const metadata: Metadata = {
  title: { default: `${PRODUCT_NAME}: ${PRODUCT_TAGLINE}`, template: `%s | ${PRODUCT_NAME}` },
  applicationName: PRODUCT_NAME,
  description: "Audit pages, components and designs against WCAG 2.2 AA and AODA, review fixes as diffs, and verify them with a rerun.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151920" },
  ],
};

// Applies a saved theme before first paint so there is no flash of the wrong theme.
const themeScript = `try{var t=JSON.parse(localStorage.getItem("awb.settings.v1")||"{}").theme;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
