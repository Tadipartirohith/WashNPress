/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  // The resident app's page lives at app/resident-app/, not app/app/. A route segment
  // literally named "app" nested one level inside the App Router's own top-level app/
  // directory made Next.js's build compile the wrong file for the root route: every
  // build — production and dev, in three independent rebuilds — produced a
  // .next/server/app/page.js containing the resident app, not the marketing homepage,
  // so "/" silently served the resident sign-in instead of the landing page. Moving
  // the folder and rewriting the URL keeps the public address exactly "/app". A
  // rewrite carries the query string through unchanged; it only needs stating for the
  // path. "/app/" (trailing slash) is matched too, since a rewrite source is otherwise
  // exact.
  async rewrites() {
    return [
      { source: "/app", destination: "/resident-app" },
      { source: "/app/", destination: "/resident-app" },
      { source: "/app/:path*", destination: "/resident-app/:path*" },
    ];
  },
  // The internal name must not become a second public address for the same page:
  // redirect it to the one URL everything else already links to.
  async redirects() {
    return [
      { source: "/resident-app", destination: "/app", permanent: true },
      { source: "/resident-app/:path*", destination: "/app/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
