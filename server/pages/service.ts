import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { PublishedPageCard } from "../../shared/published-page.ts";
import type { ChatApps } from "../chat-apps.ts";
import { createPagesInternalRoutes, createPublishedPageRoutes } from "../routes/published-pages.ts";
import type { Store } from "../store.ts";
import { applyIncludedPagesMessage, pagesAccess, pagesNotOffered } from "./access.ts";
import { createPagesClient, type PagesClient } from "./client.ts";
import { createLocalPagesHost } from "./local-store.ts";
import { createPagePublisher } from "./publisher.ts";
import { PublishedPagesStore } from "./store.ts";

/** How often live published pages' folders are checked for changes. */
const LIVE_EVERY_MS = 15_000;

/** Pages bots publish to a link: the bot tools' internal routes, the card's Unpublish, the desktop's sign-in message, and
 * the chat's page cards, which show a published page and its link. */
export function createPublishedPages(options: {
  dataDir: string;
  /** This server's Cloud home configuration, or null on a desktop or any other server. */
  cloudHome: { adminOrigin: string; machineId: string; bootstrapSecret: string } | null;
  /** True for `openmausbot serve`: no desktop app hands over a MausBot sign-in and there is no Cloud home. */
  selfHosted?: boolean;
  /** Public origin for self-hosted/local page publishing when no cloud pages access is present. */
  localOrigin?: () => string;
  patch: (threadId: string, messageId: string, text: string, card: PublishedPageCard) => void;
  /** Live pages stop when their bot can no longer read the folder, and wait while the workspace is backed up or moved. */
  liveRoots?(botId: string, threadId: string): readonly string[] | null;
  paused?(): boolean;
  fetch?: typeof fetch;
  apps?: {
    chat: Pick<ChatApps, "publishablePage" | "showPublishedPage">;
    store: Pick<Store, "botByThread" | "groupByThread" | "messagesFor" | "patchMessage">;
  };
}) {
  const store = new PublishedPagesStore(join(options.dataDir, "published-pages.json"));
  const remoteClient = createPagesClient({ access: () => pagesAccess(options.cloudHome), notOffered: () => pagesNotOffered(options.cloudHome),
    selfHosted: options.selfHosted === true,
    ...(options.fetch ? { fetch: options.fetch } : {}) });
  const localHost = options.localOrigin
    ? createLocalPagesHost({ dataDir: options.dataDir, origin: options.localOrigin, count: () => store.list().length })
    : null;
  const client: PagesClient = localHost
    ? {
        publish: (input, call) => (pagesAccess(options.cloudHome) ? remoteClient.publish(input, call) : localHost.publish(input, call)),
        unpublish: (pageId, call) => (pagesAccess(options.cloudHome) ? remoteClient.unpublish(pageId, call) : localHost.unpublish(pageId, call)),
      }
    : remoteClient;
  const apps = options.apps;
  const pageRow = (threadId: string, messageId: string) => apps?.store.messagesFor(threadId).find((message) => message.id === messageId && message.kind === "app");
  // A page card keeps its own text, the page's: only the card's link changes.
  const patch = (threadId: string, messageId: string, text: string, card: PublishedPageCard) => {
    if (pageRow(threadId, messageId)) apps!.store.patchMessage(threadId, messageId, { publishedPage: card });
    else options.patch(threadId, messageId, text, card);
  };
  const publisher = createPagePublisher({ client, store, patch, liveRoots: options.liveRoots, paused: options.paused });
  // Live pages whose folders changed are published again; each at most once a minute (the publisher's own limit).
  const liveTimer = setInterval(() => { void publisher.refreshLive(); }, LIVE_EVERY_MS);
  liveTimer.unref?.();
  const appPages = apps ? {
    botOf: (threadId: string) => (apps.store.groupByThread(threadId) ? null : apps.store.botByThread(threadId) ?? null),
    page: (threadId: string, messageId: string, rev?: number) => apps.chat.publishablePage(threadId, messageId, rev),
    published: (threadId: string, messageId: string) => {
      const card = pageRow(threadId, messageId)?.publishedPage;
      return card?.state === "live" && card.pageId ? card.pageId : null;
    },
    show: (threadId: string, messageId: string, publishedPage: PublishedPageCard) =>
      (pageRow(threadId, messageId) && apps.store.patchMessage(threadId, messageId, { publishedPage }) ? messageId : null),
  } : undefined;
  return {
    store, publisher, internal: createPagesInternalRoutes(publisher), routes: createPublishedPageRoutes(publisher, appPages), receive: applyIncludedPagesMessage,
    /** publish_page's card as the page itself, inline; null when it can't be shown so (the caller posts the link). */
    show: (args: Parameters<ChatApps["showPublishedPage"]>[0]) => apps?.chat.showPublishedPage(args) ?? null,
    servePublic: (req: IncomingMessage, res: ServerResponse, path: string) => localHost?.servePublic(req, res, path) ?? false,
  };
}
