import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve, sep } from "node:path";
import { PAGE_FILE_TYPES, PAGE_ID, PAGE_MAX_BYTES, PAGE_MAX_FILES } from "../../shared/published-page.ts";
import type { PageFile } from "./bundle.ts";
import type { PagesCall, PagesClient, PagesFailure, Published, Unpublished } from "./client.ts";

const LOCAL_PAGE_LIMIT = 1_000;
const PUBLIC_PAGE_ROUTE = /^\/api\/published-pages\/([a-z0-9]{20,63})(?:\/(.*))?$/;
const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; default-src * data: blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src * data: blob:";
const PUBLIC_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "no-cache",
  "content-security-policy": SANDBOX_CSP,
} as const;

function makePageId(): string {
  return randomBytes(16).toString("hex").slice(0, 24);
}

function safeRelativePath(raw: string): string | null {
  const clean = raw.replace(/^\/+/, "") || "index.html";
  if (clean.includes("\0") || clean.includes("\\")) return null;
  const parts = clean.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

/** Self-hosted page storage and public HTTP handler used when no remote cloud pages credential is active. */
export function createLocalPagesHost(options: {
  dataDir: string;
  origin: () => string;
  count: () => number;
}): PagesClient & { servePublic: (req: IncomingMessage, res: ServerResponse, path: string) => boolean } {
  const root = resolve(options.dataDir, "published-pages-files");

  return {
    async publish(
      input: {
        title: string;
        files: readonly PageFile[];
        pageId?: string;
        beforeUpload: (page: { pageId: string; url: string }) => void;
      },
      call: PagesCall = {},
    ): Promise<Published | PagesFailure> {
      call.assertActive?.();
      if (call.signal?.aborted) return { ok: false, reason: "unavailable", message: "Publishing was cancelled." };
      const bytes = input.files.reduce((sum, file) => sum + file.data.byteLength, 0);
      if (input.files.length > PAGE_MAX_FILES) {
        return { ok: false, reason: "refused", message: `A page can have at most ${PAGE_MAX_FILES} files.` };
      }
      if (bytes > PAGE_MAX_BYTES) {
        return { ok: false, reason: "refused", message: `A page can be at most ${PAGE_MAX_BYTES} bytes.` };
      }
      const pageId = input.pageId && PAGE_ID.test(input.pageId) ? input.pageId : makePageId();
      const base = options.origin().replace(/\/+$/, "");
      const url = `${base}/api/published-pages/${pageId}/`;
      input.beforeUpload({ pageId, url });
      const pageDir = resolve(root, pageId);
      if (!pageDir.startsWith(root + sep)) {
        return { ok: false, reason: "refused", message: "Invalid page identifier." };
      }
      rmSync(pageDir, { recursive: true, force: true });
      mkdirSync(pageDir, { recursive: true });
      for (const file of input.files) {
        const rel = safeRelativePath(file.path);
        if (!rel) continue;
        const target = resolve(pageDir, ...rel.split("/"));
        if (!target.startsWith(pageDir + sep)) continue;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.data);
      }
      const pages = Math.max(1, options.count());
      return { ok: true, pageId, url, usage: { pages, limit: LOCAL_PAGE_LIMIT }, badge: false };
    },

    async unpublish(pageId: string, call: PagesCall = {}): Promise<Unpublished | PagesFailure> {
      call.assertActive?.();
      if (!PAGE_ID.test(pageId)) return { ok: false, reason: "gone", message: "That page no longer exists." };
      const pageDir = resolve(root, pageId);
      if (pageDir.startsWith(root + sep)) {
        rmSync(pageDir, { recursive: true, force: true });
      }
      return { ok: true, pageId, usage: { pages: Math.max(0, options.count() - 1), limit: LOCAL_PAGE_LIMIT } };
    },

    servePublic(req: IncomingMessage, res: ServerResponse, path: string): boolean {
      const method = req.method ?? "GET";
      if ((method !== "GET" && method !== "HEAD") || path.endsWith("/unpublish")) return false;
      const match = PUBLIC_PAGE_ROUTE.exec(path);
      if (!match) return false;
      const pageId = match[1]!;
      const rawSubpath = match[2];
      if (rawSubpath === undefined) {
        res.writeHead(302, { location: `/api/published-pages/${pageId}/` });
        res.end();
        return true;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawSubpath);
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return true;
      }
      const rel = safeRelativePath(decoded);
      const pageDir = resolve(root, pageId);
      const target = rel ? resolve(pageDir, ...rel.split("/")) : null;
      if (!target || !pageDir.startsWith(root + sep) || !target.startsWith(pageDir + sep) || !existsSync(target)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Page not found");
        return true;
      }
      let isFile = false;
      try {
        isFile = statSync(target).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Page not found");
        return true;
      }
      const ext = target.split(".").pop()?.toLowerCase() ?? "";
      const contentType = PAGE_FILE_TYPES[ext] ?? "application/octet-stream";
      const body = method === "HEAD" ? undefined : readFileSync(target);
      res.writeHead(200, {
        ...PUBLIC_HEADERS,
        "content-type": contentType,
      });
      res.end(body);
      return true;
    },
  };
}
