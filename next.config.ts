import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Shown in the About dialog; package.json is the one place the version lives.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

/**
 * Content Security Policy, enforced. Remote images and connections are refused
 * so injected Markdown cannot beacon out. Live discussions still need the
 * realtime host, which the browser reaches by WebRTC after the server
 * exchanges SDP.
 *
 * - img-src / media-src: own routes plus data: and blob: (PNG export, voice
 *   previews). Remote images in your own notes do not load.
 * - frame-src: the in-app browser frames arbitrary http(s) pages. This app's
 *   own origin is refused before the iframe is created.
 * - script-src 'unsafe-inline': Next's inline bootstrap; 'unsafe-eval' only in
 *   development, for React Refresh.
 */
const connectSrc = [
  "'self'",
  "https://*.openai.azure.com",
  "wss://*.openai.azure.com",
  "https://*.cognitiveservices.azure.com",
  "wss://*.cognitiveservices.azure.com",
  // Speech SDK sockets for live avatars (the WebRTC media itself is not governed by CSP).
  "https://*.tts.speech.microsoft.com",
  "wss://*.tts.speech.microsoft.com",
  "https://api.openai.com",
  "wss://api.openai.com",
  ...(dev ? ["ws:", "wss:"] : []),
].join(" ");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-src http: https:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Enforced now: the app never frames itself, so clickjacking protection
  // costs nothing.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Source links open third-party sites; they need not learn notebook URLs.
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // The Docker image builds a self-contained server; local installs keep the
  // default output so `npm start` behaves as before.
  output: process.env.NEXT_OUTPUT_STANDALONE ? "standalone" : undefined,
  // These rely on Node built-ins / dynamic requires and must not be bundled.
  serverExternalPackages: ["unpdf", "mammoth", "cheerio", "undici"],
  poweredByHeader: false,
  webpack(config, { isServer, webpack }) {
    // pptxgenjs builds decks in the browser. Its ES build still names Node's
    // fs and https (for server use) with the node: scheme, which webpack
    // rejects before it reads the package's "browser" field mapping them to
    // nothing. Dropping the scheme lets that mapping apply.
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(fs|https)$/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, https: false };
    }
    return config;
  },
  experimental: {
    // Requests pass through middleware, which buffers at most 10 MB by default
    // and silently truncates anything larger. Allow the largest body the app
    // accepts — an upload, a music track, or a 200 MB notebook import — plus
    // room for multipart overhead.
    middlewareClientMaxBodySize:
      Math.max(Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024), 200 * 1024 * 1024) +
      1024 * 1024,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
