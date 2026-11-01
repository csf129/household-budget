import type { MetadataRoute } from "next";

// Web app manifest — lets the site be installed as a standalone app
// (e.g. a Chrome "Install app" window on the desktop) with its own icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Steward — Household Budget",
    short_name: "Steward",
    description: "Shared budgeting and spending tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      // SVG first for a crisp install icon on browsers that accept it
      // (matches the setup that installs cleanly on mobile). The PNGs below
      // are fallbacks, and icon-maskable-512.png covers the maskable role.
      // Next's typed manifest only allows a single purpose value, so no
      // space-separated "any maskable" here.
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
