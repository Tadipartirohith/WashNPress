import type { MetadataRoute } from "next";

// The web app manifest. Google Play's PWA-adjacent checks and every "add to home
// screen" prompt read this; without it the installed app took the browser's default
// name and a blank icon. public/ held nothing but a stray overview.html.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wash N Press — laundry, ironing & car care",
    short_name: "Wash N Press",
    description:
      "Book a doorstep pickup, follow your order from collection to delivery, and manage your plan and wallet.",
    // The resident app rather than the marketing page: somebody who installs this
    // has already decided, and does not want the storefront every time.
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The brand teal and the light background, matching the themeColor in layout.tsx.
    theme_color: "#0D8D8D",
    background_color: "#F7F9FC",
    icons: [
      // One scalable source rather than a ladder of PNGs. "any" covers every launcher
      // size; "maskable" lets Android crop it to the platform shape without the
      // droplet losing its corners, which the padded tile leaves room for.
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "maskable" },
    ],
  };
}
