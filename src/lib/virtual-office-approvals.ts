import type { InboxRow, InboxView } from "../../shared/inbox";
import { openPersonWait } from "../../shared/person-wait";
import { pendingApprovals, type Pending } from "@/components/PendingApproval";
import { answerKindOf, asMessage, headlineOf } from "@/components/inbox/inbox-answer";
import { answerThread, rowsIn, textOf } from "@/components/inbox/inbox-view";
import { t } from "@/lib/i18n";
import { visibleMessages, type Bot, type Message } from "@/state/store";

export type OfficeApprovalKind =
  | "approval"
  | "question"
  | "review"
  | "password"
  | "sign-in"
  | "connect"
  | "reply";

export interface OfficeApprovalQueueItem {
  id: string;
  kind: OfficeApprovalKind;
  bot: Bot;
  threadId: string;
  at: number;
  headline: string;
  detail?: string;
  sectionName: string;
  message?: Message;
  pendingApproval?: Pending;
  inboxRow?: InboxRow;
}

export function approvalKindLabel(kind: OfficeApprovalKind): string {
  switch (kind) {
    case "approval":
      return t("office3d.queue.kindApproval");
    case "question":
      return t("office3d.queue.kindQuestion");
    case "password":
      return t("office3d.queue.kindPassword");
    case "connect":
      return t("office3d.queue.kindConnect");
    case "sign-in":
      return t("office3d.queue.kindSignIn");
    case "review":
      return t("office3d.queue.kindReview");
    case "reply":
      return t("office3d.queue.kindReply");
  }
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
      .find(Boolean) ?? ""
  );
}

function snippetOf(row: InboxRow): string | null {
  const text = textOf(row).replace(/\s+/g, " ").trim();
  const headline = headlineOf(row);
  if (!text || text === headline) return null;
  return text.startsWith(headline) ? text.slice(headline.length).trim() || null : text;
}

function rankKind(kind: OfficeApprovalKind): number {
  if (kind === "approval") return 0;
  if (kind === "question") return 1;
  if (kind === "password" || kind === "connect" || kind === "sign-in") return 2;
  return 3;
}

export function buildOfficeApprovalQueue({
  bots,
  inboxView,
  sectionNameByBotId,
}: {
  bots: readonly Bot[];
  inboxView: InboxView | null;
  sectionNameByBotId: Readonly<Record<string, string>>;
}): OfficeApprovalQueueItem[] {
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const items: OfficeApprovalQueueItem[] = [];
  const seen = new Set<string>();
  const coveredBots = new Set<string>();

  const sectionOf = (bot: Bot) =>
    sectionNameByBotId[bot.id] || bot.section?.trim() || t("settings.section.general");

  for (const row of rowsIn(inboxView, "needs-you")) {
    const botId = row.origin?.botId ?? row.from.botId ?? inboxView?.botId;
    const bot = botId ? botById.get(botId) : undefined;
    if (!bot) continue;

    const rawKind = answerKindOf(row);
    const kind: OfficeApprovalKind = rawKind === "none" ? "reply" : rawKind;
    const threadId = answerThread(inboxView, row) ?? row.origin?.threadId ?? bot.threadId;
    const message = asMessage(row);
    const pending = kind === "approval" ? pendingApprovals([message])[0] : undefined;
    if (kind === "approval" && !pending) continue;

    const reqKey = row.card?.requestId ? `req:${bot.id}:${threadId}:${row.card.requestId}` : null;
    const msgKey = `msg:${row.origin?.threadId ?? threadId}:${row.origin?.messageId ?? row.id}`;
    if ((reqKey && seen.has(reqKey)) || seen.has(msgKey)) continue;
    if (reqKey) seen.add(reqKey);
    seen.add(msgKey);
    coveredBots.add(bot.id);

    const headline = headlineOf(row) || approvalKindLabel(kind);
    const detail = pending?.detail || snippetOf(row) || undefined;
    items.push({
      id: reqKey ?? `inbox:${row.id}`,
      kind,
      bot,
      threadId,
      at: row.at,
      headline,
      detail,
      sectionName: sectionOf(bot),
      message,
      pendingApproval: pending,
      inboxRow: row,
    });
  }

  for (const bot of bots) {
    const msgs = visibleMessages(bot);

    for (const pending of pendingApprovals(msgs)) {
      const reqKey = `req:${bot.id}:${bot.threadId}:${pending.requestId}`;
      const msgKey = `msg:${bot.threadId}:${pending.message.id}`;
      if (seen.has(reqKey) || seen.has(msgKey)) continue;
      seen.add(reqKey);
      seen.add(msgKey);
      coveredBots.add(bot.id);

      const card = pending.message.card;
      const headline =
        firstNonEmptyLine(card?.subtitle || card?.title || "")
        || pending.tool
        || approvalKindLabel("approval");

      items.push({
        id: reqKey,
        kind: "approval",
        bot,
        threadId: bot.threadId,
        at: pending.message.at,
        headline,
        detail: pending.detail || undefined,
        sectionName: sectionOf(bot),
        message: pending.message,
        pendingApproval: pending,
      });
    }

    const wait = openPersonWait(msgs);
    if (wait && wait.kind !== "approval") {
      const message = msgs.find((entry) => entry.id === wait.messageId);
      const reqKey = message?.card?.requestId ? `req:${bot.id}:${bot.threadId}:${message.card.requestId}` : null;
      const msgKey = `msg:${bot.threadId}:${wait.messageId}`;
      if ((!reqKey || !seen.has(reqKey)) && !seen.has(msgKey)) {
        if (reqKey) seen.add(reqKey);
        seen.add(msgKey);
        coveredBots.add(bot.id);

        const headline = firstNonEmptyLine(wait.label) || approvalKindLabel(wait.kind);
        const detailText = message?.text?.trim();
        items.push({
          id: reqKey ?? msgKey,
          kind: wait.kind,
          bot,
          threadId: bot.threadId,
          at: wait.at,
          headline,
          detail: detailText && detailText !== headline ? detailText : undefined,
          sectionName: sectionOf(bot),
          message,
        });
      }
    }
  }

  for (const bot of bots) {
    if (coveredBots.has(bot.id)) continue;
    const waitingTask = (bot.tasks ?? []).find(
      (task) => !task.archivedAt && (task.activity === "waiting-on-you" || (task.openAsks ?? 0) > 0),
    );
    if (bot.activity !== "waiting-on-you" && !waitingTask) continue;

    const threadId = waitingTask?.threadId ?? bot.threadId;
    const msgs = threadId === bot.threadId ? visibleMessages(bot) : [];
    const lastBotMsg = [...msgs]
      .reverse()
      .find((entry) => entry.role === "bot" && entry.kind === "text" && entry.text?.trim());
    const rawPreview =
      lastBotMsg?.text?.trim() || waitingTask?.title?.trim() || t("office3d.activity.waiting");
    const headline = firstNonEmptyLine(rawPreview) || t("office3d.activity.waiting");
    const at = lastBotMsg?.at ?? waitingTask?.updatedAt ?? waitingTask?.createdAt ?? 0;

    items.push({
      id: `wait:${bot.id}:${threadId}`,
      kind: "reply",
      bot,
      threadId,
      at,
      headline,
      detail: rawPreview !== headline ? rawPreview : undefined,
      sectionName: sectionOf(bot),
      message: lastBotMsg,
    });
  }

  return items.sort(
    (a, b) =>
      rankKind(a.kind) - rankKind(b.kind)
      || (a.at || Number.MAX_SAFE_INTEGER) - (b.at || Number.MAX_SAFE_INTEGER),
  );
}
