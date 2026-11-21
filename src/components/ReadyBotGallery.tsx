import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Loader2, Plus } from "lucide-react";
import { stoppedAtBotLimit } from "@/lib/bot-limit";
import { BotAvatar } from "./Avatar";
import { NewBotDialog } from "./lazy-screens";
import { READY_BOT_CATEGORIES, READY_BOTS, matchesReadyBot, readyBotCopy, registerRemoteReadyBot, type ReadyBotCategory } from "@/lib/ready-bots";
import {
  fetchTemplatePayload,
  openWebAuthOrTemplateCheckout,
  toReadyBot,
  useRemoteTemplateMarketplace,
  type RemoteTemplateCatalogEntry,
} from "@/lib/template-store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore, type Bot } from "@/state/store";

const APP_LABELS: Record<string, string> = {
  gmail: "Gmail", github: "GitHub", discord: "Discord", slack: "Slack", googlecalendar: "Google Calendar",
  notion: "Notion", linear: "Linear", figma: "Figma", gong: "Gong", hubspot: "HubSpot", postiz: "Postiz",
};

const CATEGORY_KEYS: Record<ReadyBotCategory, LocaleKey> = {
  everyday: "readyBots.category.everyday", work: "readyBots.category.work", writing: "readyBots.category.writing",
  design: "readyBots.category.design", sales: "readyBots.category.sales", personal: "readyBots.category.personal",
};

export function ReadyBotGallery({ search, onDialog, onAdded }: {
  search: string;
  /** The New bot dialog is open over Templates, so Templates must leave its keys alone. */
  onDialog: (open: boolean) => void;
  onAdded: (bot: Bot) => void;
}) {
  const [category, setCategory] = useState<ReadyBotCategory | null>(null);
  const { state, dispatch } = useStore();
  const [adding, setAdding] = useState<string | null>(null);
  const [busyRemoteId, setBusyRemoteId] = useState<string | null>(null);
  const { botEntries, unlockedIds, reload } = useRemoteTemplateMarketplace();
  const open = (id: string | null) => {
    if (id !== null && stoppedAtBotLimit(state)) return;
    // A paired device may not read the host's New bot defaults that the review is filled from.
    if (id !== null && window.ogb?.remoteClient?.active) { dispatch({ type: "newBot", onCreated: onAdded }); return; }
    setAdding(id); onDialog(id !== null);
  };
  const openRemoteBot = async (entry: RemoteTemplateCatalogEntry) => {
    if (stoppedAtBotLimit(state)) return;
    const isUnlocked = !entry.isPaid || unlockedIds.has(entry.id);
    if (!isUnlocked) {
      await openWebAuthOrTemplateCheckout({
        buyTemplateId: entry.id,
        onCompleted: () => void reload(),
      });
      return;
    }
    setBusyRemoteId(entry.id);
    try {
      const payload = await fetchTemplatePayload(entry.id);
      const builtinBot = READY_BOTS.find((b) => b.id === entry.id);
      const mergedBot = toReadyBot(entry, payload);
      if (builtinBot) {
        if (!payload?.soul) mergedBot.soul = builtinBot.soul;
        if (!mergedBot.notes || Object.keys(mergedBot.notes).length === 0) {
          mergedBot.notes = builtinBot.notes;
        }
        if (!mergedBot.routines || mergedBot.routines.length === 0) {
          mergedBot.routines = builtinBot.routines;
        }
      }
      registerRemoteReadyBot(mergedBot);
      setAdding(entry.id);
      onDialog(true);
    } finally {
      setBusyRemoteId(null);
    }
  };
  const builtinIds = new Set(READY_BOTS.map((b) => b.id));
  const remoteBotIds = new Set(botEntries.map((b) => b.id));
  const hasSeededBuiltins = botEntries.filter((b) => builtinIds.has(b.id)).length >= 10;
  const visible = hasSeededBuiltins
    ? []
    : READY_BOTS.filter(
        (bot) => !remoteBotIds.has(bot.id) && (!category || bot.category === category) && matchesReadyBot(bot, search)
      );
  const visibleRemote = botEntries.filter(
    (entry) =>
      (!category || entry.category === category) &&
      matchesReadyBot(toReadyBot(entry, null), search)
  );
  if (search.trim() && visible.length === 0 && visibleRemote.length === 0) return null;
  return <section className="mb-8" aria-labelledby="ready-bots-title">
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="ready-bots-title" className="text-[12px] font-medium text-ink-secondary">{t("readyBots.title")}</h3>
      <p className="text-[12px] text-ink-tertiary">{t("readyBots.subtitle")}</p>
    </div>
    <div className="mb-3 mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("readyBots.categories")}>
      {[null, ...READY_BOT_CATEGORIES].map((value) => <button key={value ?? "all"} type="button" aria-pressed={category === value}
        onClick={() => setCategory(value)}
        className={cn("rounded-full px-3 py-1 text-[13px] transition-colors",
          category === value ? "bg-ink text-panel" : "bg-raised/70 text-ink-secondary hover:text-ink")}>
        {value ? t(CATEGORY_KEYS[value]) : t("readyBots.all")}
      </button>)}
    </div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {visible.map((bot) => { const copy = readyBotCopy(bot); return <article key={bot.id} data-ready-bot={bot.id} className="flex flex-col rounded-2xl border border-hairline/40 bg-card p-4">
        <div className="flex items-center gap-3">
          <BotAvatar bot={{ color: bot.look.color, mascotBody: bot.look.mascotBody, name: bot.name }} size={40} animated={false} label={bot.name} />
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-[14px] font-medium text-ink">{bot.name}</h4>
            <p className="truncate text-[12px] text-ink-secondary">{copy.title} · {t(CATEGORY_KEYS[bot.category])}</p>
          </div>
          <button type="button" onClick={() => open(bot.id)} aria-label={t("readyBots.addAria", { name: bot.name, title: copy.title })}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-raised px-3 text-[13px] font-medium text-ink hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent">
            <Plus size={14} aria-hidden="true" />{t("readyBots.add")}
          </button>
        </div>
        <p className="mt-3 text-[13px] leading-[1.45] text-ink-secondary">{copy.description}</p>
        <p className="mt-2 text-[12px] italic text-ink-tertiary">{t("readyBots.try", { prompt: copy.tryAsking })}</p>
        {(bot.apps.length > 0 || bot.routines?.length) && <p className="mt-auto pt-2 text-[12px] text-ink-tertiary">
          {[bot.apps.length > 0 && t("readyBots.worksWith", { apps: bot.apps.map((app) => APP_LABELS[app] ?? app).join(", ") }),
            bot.routines?.length && t("readyBots.pausedRoutine")].filter(Boolean).join(" · ")}
        </p>}
      </article>; })}
      {visibleRemote.map((entry) => {
        const isUnlocked = !entry.isPaid || unlockedIds.has(entry.id);
        const isBusy = busyRemoteId === entry.id;
        return (
          <article key={entry.id} data-ready-bot={entry.id} className="flex flex-col rounded-2xl border border-hairline/40 bg-card p-4">
            <div className="flex items-center gap-3">
              <BotAvatar bot={{ color: entry.look.color, mascotBody: entry.look.mascotBody, name: entry.name }} size={40} animated={false} label={entry.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h4 className="truncate text-[14px] font-medium text-ink">{entry.name}</h4>
                  {entry.isPaid && (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", isUnlocked ? "bg-success/15 text-success" : "bg-accent/15 text-accent-text")}>
                      {isUnlocked ? "Đã sở hữu" : `${entry.priceVnd.toLocaleString("vi-VN")}đ`}
                    </span>
                  )}
                </div>
                <p className="truncate text-[12px] text-ink-secondary">{entry.title} · {t(CATEGORY_KEYS[entry.category])}</p>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void openRemoteBot(entry)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50",
                  isUnlocked
                    ? "bg-raised text-ink hover:bg-raised-hover"
                    : "bg-accent text-accent-ink hover:bg-accent/90"
                )}
              >
                {isBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : isUnlocked ? (
                  <Plus size={14} aria-hidden="true" />
                ) : (
                  <Lock size={13} aria-hidden="true" />
                )}
                {isUnlocked ? t("readyBots.add") : "Mua mẫu"}
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-[1.45] text-ink-secondary">{entry.description}</p>
            {entry.tryAsking[0] && (
              <p className="mt-2 text-[12px] italic text-ink-tertiary">{t("readyBots.try", { prompt: entry.tryAsking[0] })}</p>
            )}
            {(entry.apps.length > 0 || entry.hasPausedRoutine) && (
              <p className="mt-auto pt-2 text-[12px] text-ink-tertiary">
                {[
                  entry.apps.length > 0 && t("readyBots.worksWith", { apps: entry.apps.map((app) => APP_LABELS[app] ?? app).join(", ") }),
                  entry.hasPausedRoutine && t("readyBots.pausedRoutine"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </article>
        );
      })}
    </div>
    {adding && createPortal(<NewBotDialog readyBotId={adding} onClose={() => open(null)} onCreated={(bot) => { onDialog(false); onAdded(bot); }} />, document.body)}
  </section>;
}
