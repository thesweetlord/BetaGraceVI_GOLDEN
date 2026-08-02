import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config.js";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

const isSuppressedWarning = (msg: unknown): boolean =>
  typeof msg === "string" &&
  msg.includes("did not pass the `from` option to `postcss.parse`");

export async function setupVite(server: Server, app: Express) {
  // Replit's reverse proxy terminates TLS and forwards to our server on
  // localhost.  The Vite HMR client must therefore:
  //   • connect to the public Replit domain (not localhost)
  //   • use WSS (not WS) because the proxy sits behind HTTPS/443
  //   • use clientPort 443 so the URL has no explicit port (standard WSS)
  //
  // Without this, Vite defaults to ws://localhost:5173 and the browser
  // blocks the connection, causing the "Run this app" empty preview on
  // desktop and mobile alike.
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  const hmrConfig = replitDomain
    ? {
        server,
        path: "/vite-hmr",
        host: replitDomain,
        protocol: "wss" as const,
        clientPort: 443,
      }
    : { server, path: "/vite-hmr" };

  const serverOptions = {
    middlewareMode: true,
    hmr: hmrConfig,
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      warn: (msg: string, options?: any) => {
        if (isSuppressedWarning(msg)) return;
        viteLogger.warn(msg, options);
      },
      warnOnce: (msg: string, options?: any) => {
        if (isSuppressedWarning(msg)) return;
        viteLogger.warnOnce(msg, options);
      },
      error: (msg: string, options?: any) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
