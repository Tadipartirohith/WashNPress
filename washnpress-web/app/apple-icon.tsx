import { ImageResponse } from "next/og";

// iOS ignores SVG for the home-screen icon, so the one at app/icon.svg cannot serve
// double duty. Rather than commit a binary, the same mark is drawn here and rendered
// to a PNG at build time — one definition, and no image file to keep in step with
// the logo by hand.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // iOS applies its own rounding and never renders transparency, so the tile
          // is drawn square and filled edge to edge.
          background: "#0D8D8D",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 64 64" fill="none">
          <path d="M32 12.5c9.1 10.4 15 18.4 15 26.1A15 15 0 0 1 32 53.5a15 15 0 0 1-15-14.9c0-7.7 5.9-15.7 15-26.1Z" fill="#FFFFFF" />
          <path d="M32 12.5c9.1 10.4 15 18.4 15 26.1A15 15 0 0 1 32 53.5" stroke="#F59F0A" strokeWidth="4" strokeLinecap="round" />
          <circle cx="38.7" cy="28" r="3.5" fill="#F59F0A" />
        </svg>
      </div>
    ),
    size,
  );
}
