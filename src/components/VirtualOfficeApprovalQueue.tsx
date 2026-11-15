import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Focus,
  MessageCircle,
  ShieldAlert,
  X,
} from "lucide-react";

import { BotAvatar } from "./Avatar";
import { cardAnswerFor } from "./bot-access/access-card";
import { ConnectorCard } from "./ConnectorCard";
import { recommendedOf } from "./inbox/inbox-answer";
import { PendingApprovalActions, PendingApprovalPanel } from "./PendingApproval";
import { answersInOneTap, cardQuestions, QuestionCard } from "./QuestionCard";
import { SecretRequestCard } from "./SecretRequestCard";
import { SignInRequestCard } from "./SignInRequestCard";
import { dismissResponse } from "@/lib/card-answer";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { randomUuid } from "@/lib/random-uuid";
import { imeComposing, sendsMessage, useSendKey } from "@/lib/send-key";
import {
  approvalKindLabel,
  buildOfficeApprovalQueue,
  type OfficeApprovalQueueItem,
} from "@/lib/virtual-office-approvals";
import {
  inboxVersion,
  readInboxRow,
  refreshInbox,
  replyToInboxRow,
  settleInboxRow,
  useInboxView,
} from "@/state/inbox";
import { stopLiveReply } from "@/state/live-reply";
import { api, useStore, type Bot } from "@/state/store";
import { formatQuestionAnswers } from "../../shared/ask-question";
import type { InboxView } from "../../shared/inbox";

export function useOfficeApprovalQueue({
  bots,
  desks,
  onFocusCameraOnBot,
  onAllCleared,
}: {
  bots: readonly Bot[];
  desks: readonly { bot: { id: string }; sectionName: string }[];
  onFocusCameraOnBot: (botId: string) => void;
  onAllCleared: () => void;
}) {
  const version = useMemo(() => inboxVersion(bots), [bots]);
  useEffect(() => {
    if (version) void refreshInbox();
  }, [version]);
  const inboxView = useInboxView();

  const sectionNameByBotId = useMemo(
    () => Object.fromEntries(desks.map((desk) => [desk.bot.id, desk.sectionName])),
    [desks],
  );

  const rawItems = useMemo(
    () => buildOfficeApprovalQueue({ bots, inboxView, sectionNameByBotId }),
    [bots, inboxView, sectionNameByBotId],
  );

  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const hadOpenItemsRef = useRef(false);
  const lastFocusedItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    setResolvedIds((previous) => {
      if (!previous.length) return previous;
      const rawSet = new Set(rawItems.map((entry) => entry.id));
      const next = previous.filter((id) => rawSet.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [rawItems]);

  const items = useMemo(
    () => (resolvedIds.length ? rawItems.filter((entry) => !resolvedIds.includes(entry.id)) : rawItems),
    [rawItems, resolvedIds],
  );

  const activeItem = useMemo(() => {
    if (!items.length) return null;
    if (!activeItemId) return items[0] ?? null;
    return items.find((entry) => entry.id === activeItemId) ?? items[0] ?? null;
  }, [items, activeItemId]);

  useEffect(() => {
    if (!open) {
      hadOpenItemsRef.current = false;
      lastFocusedItemIdRef.current = null;
      return;
    }
    if (items.length > 0 && activeItem) {
      hadOpenItemsRef.current = true;
      if (activeItem.id !== activeItemId) {
        setActiveItemId(activeItem.id);
      }
      if (lastFocusedItemIdRef.current !== activeItem.id) {
        lastFocusedItemIdRef.current = activeItem.id;
        onFocusCameraOnBot(activeItem.bot.id);
      }
      return;
    }
    if (hadOpenItemsRef.current && items.length === 0) {
      hadOpenItemsRef.current = false;
      lastFocusedItemIdRef.current = null;
      setOpen(false);
      onAllCleared();
    }
  }, [open, items.length, activeItem, activeItemId, onFocusCameraOnBot, onAllCleared]);

  const openForBot = useCallback(
    (botId?: string) => {
      const target = (botId ? items.find((entry) => entry.bot.id === botId) : undefined) ?? items[0];
      if (!target) return false;
      setActiveItemId(target.id);
      lastFocusedItemIdRef.current = target.id;
      setOpen(true);
      onFocusCameraOnBot(target.bot.id);
      return true;
    },
    [items, onFocusCameraOnBot],
  );

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const selectItem = useCallback(
    (id: string, botId: string) => {
      setActiveItemId(id);
      lastFocusedItemIdRef.current = id;
      onFocusCameraOnBot(botId);
    },
    [onFocusCameraOnBot],
  );

  const markResolved = useCallback((id: string) => {
    setResolvedIds((previous) => (previous.includes(id) ? previous : [...previous, id]));
  }, []);

  const restoreItem = useCallback((id: string) => {
    setResolvedIds((previous) => previous.filter((entry) => entry !== id));
  }, []);

  return {
    items,
    inboxView,
    open: open && items.length > 0,
    activeItemId: activeItem?.id ?? null,
    activeBotId: activeItem?.bot.id ?? null,
    openForBot,
    close,
    selectItem,
    markResolved,
    restoreItem,
  };
}

export function VirtualOfficeApprovalPill({
  items,
  botDisplayNames,
  open,
  onToggle,
}: {
  items: readonly OfficeApprovalQueueItem[];
  botDisplayNames: Readonly<Record<string, string>>;
  open: boolean;
  onToggle: () => void;
}) {
  const lead = items[0];
  if (!lead) return null;
  const leadName = botDisplayNames[lead.bot.id] ?? lead.bot.name;

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-25 flex max-w-[calc(100%-2rem)] -translate-x-1/2 justify-center">
      <button
        type="button"
        data-office-approval-pill
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "pointer-events-auto flex max-w-[440px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12px] font-medium shadow-lg backdrop-blur-md transition-colors",
          open
            ? "border-warning/60 bg-panel text-ink ring-2 ring-warning/25"
            : "border-warning/50 bg-panel/95 text-ink hover:bg-card",
        )}
      >
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-warning" />
        </span>
        <span className="shrink-0 font-semibold text-ink">
          {t("office3d.queue.pillLabel", { count: items.length })}
        </span>
        <span className="text-ink-tertiary">·</span>
        <span dir="auto" className="min-w-0 truncate text-ink-secondary">
          {leadName}: {lead.headline}
        </span>
      </button>
    </div>
  );
}

export function VirtualOfficeApprovalQueueCard({
  items,
  activeItemId,
  inboxView,
  botDisplayNames,
  now,
  onSelectItem,
  onFocusBotDesk,
  onOpenDeskChat,
  onItemResolved,
  onRestoreItem,
  onClose,
}: {
  items: readonly OfficeApprovalQueueItem[];
  activeItemId: string | null;
  inboxView: InboxView | null;
  botDisplayNames: Readonly<Record<string, string>>;
  now: number;
  onSelectItem: (id: string, botId: string) => void;
  onFocusBotDesk: (botId: string) => void;
  onOpenDeskChat: (botId: string, threadId: string) => void;
  onItemResolved: (id: string) => void;
  onRestoreItem: (id: string) => void;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const sendKey = useSendKey();
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const hydratedThreadsRef = useRef<Set<string>>(new Set());

  const currentIndex = useMemo(() => {
    if (!items.length) return -1;
    if (!activeItemId) return 0;
    const found = items.findIndex((entry) => entry.id === activeItemId);
    return found >= 0 ? found : 0;
  }, [items, activeItemId]);

  const item = currentIndex >= 0 ? items[currentIndex] : undefined;

  useEffect(() => {
    setReplyText("");
  }, [item?.id]);

  useEffect(() => {
    if (!item || item.inboxRow || item.threadId === item.bot.threadId) return;
    const key = `${item.bot.id}:${item.threadId}`;
    if (hydratedThreadsRef.current.has(key)) return;
    hydratedThreadsRef.current.add(key);
    void api<{ bot?: Bot }>(`/api/bots/${item.bot.id}/tasks/${item.threadId}?messages=40`, {
      method: "POST",
      body: "{}",
    })
      .then((res) => {
        if (res?.bot) dispatch({ type: "taskSwitched", bot: res.bot });
      })
      .catch(() => {});
  }, [item, dispatch]);

  const stepQueue = useCallback(
    (delta: number) => {
      if (items.length < 2 || currentIndex < 0) return;
      const nextIdx = (currentIndex + delta + items.length) % items.length;
      const next = items[nextIdx];
      if (next) onSelectItem(next.id, next.bot.id);
    },
    [items, currentIndex, onSelectItem],
  );

  const cancelCurrentTurn = useCallback(() => {
    if (!item) return;
    stopLiveReply(item.threadId);
    dispatch({ type: "interrupt", botId: item.bot.id, threadId: item.threadId });
    onItemResolved(item.id);
  }, [item, dispatch, onItemResolved]);

  const answerSingleChoice = useCallback(
    (choiceLabel: string) => {
      const card = item?.message?.card;
      const requestId = card?.requestId;
      if (!item || !card || !requestId) return;
      const questions = cardQuestions(card);
      const formatted = card.questionRequest
        ? formatQuestionAnswers(questions, [[choiceLabel]])
        : cardAnswerFor(card, choiceLabel);
      if (!formatted) return;

      const itemId = item.id;
      if (item.inboxRow) {
        readInboxRow(item.inboxRow);
        settleInboxRow(item.inboxRow);
      }
      onItemResolved(itemId);
      dispatch({
        type: "decideRequest",
        threadId: item.threadId,
        requestId,
        behavior: "answer",
        message: formatted,
        onError: () => {
          onRestoreItem(itemId);
          void refreshInbox();
        },
      });
    },
    [item, dispatch, onItemResolved, onRestoreItem],
  );

  const skipCurrentQuestion = useCallback(() => {
    const card = item?.message?.card;
    const requestId = card?.requestId;
    if (!item || !card || !requestId) return;
    const close = dismissResponse(card);
    const itemId = item.id;
    if (item.inboxRow) {
      readInboxRow(item.inboxRow);
      settleInboxRow(item.inboxRow);
    }
    onItemResolved(itemId);
    dispatch({
      type: "decideRequest",
      threadId: item.threadId,
      requestId,
      behavior: close.behavior,
      ...(close.message ? { message: close.message } : {}),
      onError: () => {
        onRestoreItem(itemId);
        void refreshInbox();
      },
    });
  }, [item, dispatch, onItemResolved, onRestoreItem]);

  const sendQuickReply = useCallback(
    async (overrideText?: string) => {
      if (!item || sendingReply || item.bot.yourAccess === "view") return;
      const body = (overrideText ?? replyText).trim();
      if (!body) return;

      if (item.kind === "question" && item.message?.card?.requestId) {
        answerSingleChoice(body);
        return;
      }

      const itemId = item.id;
      setSendingReply(true);
      onItemResolved(itemId);
      try {
        if (item.inboxRow && inboxView) {
          settleInboxRow(item.inboxRow);
          await replyToInboxRow(inboxView, item.inboxRow, body);
        } else {
          dispatch({
            type: "send",
            botId: item.bot.id,
            threadId: item.threadId,
            text: body,
            sendId: randomUuid(),
            mode: "chat",
          });
        }
        if (overrideText === undefined) setReplyText("");
      } catch {
        onRestoreItem(itemId);
      } finally {
        setSendingReply(false);
      }
    },
    [item, sendingReply, replyText, answerSingleChoice, onItemResolved, inboxView, dispatch, onRestoreItem],
  );

  if (!item) return null;

  const botName = botDisplayNames[item.bot.id] ?? item.bot.name;
  const canWrite = item.bot.yourAccess !== "view";
  const waitMinutes = item.at > 0 ? Math.max(1, Math.round((now - item.at) / 60_000)) : 0;

  const questionCard = item.kind === "question" && item.message?.card ? item.message.card : undefined;
  const questions = questionCard ? cardQuestions(questionCard) : [];
  const oneTapQuestion =
    questionCard && Boolean(questionCard.requestId) && answersInOneTap(questions) ? questions[0] : undefined;

  return (
    <section
      data-office-approval-queue
      aria-label={t("office3d.queue.title")}
      className="pointer-events-auto absolute right-4 top-4 z-30 flex max-h-[min(580px,calc(100%-2rem))] w-[404px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-hairline/70 bg-panel/95 shadow-2xl backdrop-blur-md"
    >
      <header className="shrink-0 border-b border-hairline/50 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BellRing size={15} className="shrink-0 text-warning" />
            <h2 className="truncate text-[13px] font-semibold text-ink">
              {t("office3d.queue.title")}
            </h2>
            <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-warning">
              {currentIndex + 1}/{items.length}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {items.length > 1 && (
              <>
                <button
                  type="button"
                  data-office-queue-prev
                  onClick={() => stepQueue(-1)}
                  title={t("office3d.queue.prev")}
                  aria-label={t("office3d.queue.prev")}
                  className="rounded-lg p-1 text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  data-office-queue-next
                  onClick={() => stepQueue(1)}
                  title={t("office3d.queue.next")}
                  aria-label={t("office3d.queue.next")}
                  className="rounded-lg p-1 text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <ChevronRight size={15} />
                </button>
              </>
            )}
            <button
              type="button"
              data-office-queue-close
              onClick={onClose}
              title={t("office3d.queue.collapse")}
              aria-label={t("office3d.queue.collapse")}
              className="rounded-lg p-1 text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {items.length > 1 && (
          <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {items.map((entry) => {
              const entryName = botDisplayNames[entry.bot.id] ?? entry.bot.name;
              const selected = entry.id === item.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-office-queue-tab={entry.bot.id}
                  aria-pressed={selected}
                  onClick={() => onSelectItem(entry.id, entry.bot.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    selected
                      ? "border-accent bg-accent/15 text-ink"
                      : "border-hairline/60 bg-card text-ink-secondary hover:bg-ink/[0.06] hover:text-ink",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      entry.kind === "approval" ? "bg-warning" : "bg-accent",
                    )}
                  />
                  <span className="max-w-[110px] truncate">{entryName}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-inset px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <BotAvatar bot={item.bot} size={30} animated={item.bot.busy} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-ink">{botName}</span>
                {item.bot.chiefOfStaff && <Crown size={12} className="shrink-0 text-warning" />}
                <span className="shrink-0 rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary">
                  {approvalKindLabel(item.kind)}
                </span>
              </div>
              <p className="truncate text-[11px] text-ink-tertiary">
                {item.sectionName}
                {waitMinutes > 0 ? ` · ${t("office3d.queue.waitingSince", { minutes: waitMinutes })}` : ""}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onFocusBotDesk(item.bot.id)}
              title={t("office3d.focusDesk")}
              aria-label={t("office3d.focusDesk")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <Focus size={14} />
            </button>
            <button
              type="button"
              data-office-queue-open-chat
              onClick={() => onOpenDeskChat(item.bot.id, item.threadId)}
              title={t("office3d.queue.openDeskChat")}
              aria-label={t("office3d.queue.openDeskChat")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <MessageCircle size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {item.kind === "approval" && item.pendingApproval ? (
          <div
            onClick={(event) => {
              const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                "[data-office-queue-action]",
              );
              if (!target) return;
              const act = target.dataset.officeQueueAction;
              if (act === "allow" || act === "deny") {
                if (item.inboxRow) settleInboxRow(item.inboxRow);
                onItemResolved(item.id);
              }
            }}
          >
            <PendingApprovalPanel
              pending={item.pendingApproval}
              count={items.length}
              index={currentIndex}
              botName={botName}
              actions={
                <PendingApprovalActions
                  pending={item.pendingApproval}
                  threadId={item.threadId}
                  bot={item.bot}
                  onCancelTurn={cancelCurrentTurn}
                  part="primary"
                  tag="office-queue"
                />
              }
              more={
                <PendingApprovalActions
                  pending={item.pendingApproval}
                  threadId={item.threadId}
                  bot={item.bot}
                  onCancelTurn={cancelCurrentTurn}
                  part="more"
                  tag="office-queue"
                />
              }
            />
          </div>
        ) : oneTapQuestion ? (
          <div className="space-y-2.5 p-4">
            <div className="flex items-start justify-between gap-2">
              <p dir="auto" className="text-[13px] font-medium leading-[18px] text-ink">
                {oneTapQuestion.question}
              </p>
              <button
                type="button"
                data-office-queue-skip
                onClick={skipCurrentQuestion}
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
              >
                {t("office3d.queue.dismissQuestion")}
              </button>
            </div>

            <div className="space-y-1.5">
              {oneTapQuestion.options.map((option) => {
                const { label, recommended } = recommendedOf(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    data-office-queue-choice={label}
                    onClick={() => answerSingleChoice(option.label)}
                    className="flex w-full items-start justify-between gap-2 rounded-xl border border-hairline/60 bg-card px-3 py-2 text-left transition-colors hover:border-accent/50 hover:bg-ink/[0.06]"
                  >
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block text-[13px] font-medium leading-[18px] text-ink">
                        {label}
                      </span>
                      {option.description && (
                        <span dir="auto" className="mt-0.5 block text-[12px] leading-[16px] text-ink-secondary">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {recommended && (
                      <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                        {t("inbox.recommended")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {oneTapQuestion.custom !== false && canWrite && (
              <div className="flex items-center gap-1.5 rounded-xl border border-hairline/70 bg-inset px-2.5 py-1.5 focus-within:border-accent">
                <input
                  type="text"
                  dir="auto"
                  data-office-queue-input
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  onKeyDown={(event) => {
                    if (sendsMessage(event.nativeEvent, sendKey) && !imeComposing(event.nativeEvent)) {
                      event.preventDefault();
                      void sendQuickReply();
                    }
                  }}
                  placeholder={t("office3d.queue.customPlaceholder", { name: botName })}
                  className="min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-tertiary focus:outline-none"
                />
                <button
                  type="button"
                  data-office-queue-send
                  disabled={!replyText.trim()}
                  onClick={() => void sendQuickReply()}
                  aria-label={t("chat.send")}
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    replyText.trim()
                      ? "bg-accent text-accent-ink hover:brightness-110"
                      : "bg-control text-ink-tertiary opacity-50",
                  )}
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            )}
          </div>
        ) : item.kind === "question" && item.message ? (
          <div className="p-3">
            <QuestionCard threadId={item.threadId} asker={item.bot} message={item.message} />
          </div>
        ) : item.kind === "password" && item.message ? (
          <div className="p-3">
            <SecretRequestCard
              botId={item.bot.id}
              color={item.bot.color}
              threadId={item.threadId}
              message={item.message}
            />
          </div>
        ) : item.kind === "connect" && item.message ? (
          <div className="p-3">
            <ConnectorCard
              botId={item.bot.id}
              color={item.bot.color}
              threadId={item.threadId}
              message={item.message}
            />
          </div>
        ) : item.kind === "sign-in" && item.message ? (
          <div className="p-3">
            <SignInRequestCard
              botId={item.bot.id}
              botName={botName}
              color={item.bot.color}
              threadId={item.threadId}
              message={item.message}
            />
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <div className="rounded-xl border border-hairline/60 bg-card px-3 py-2.5">
              <div className="flex items-start gap-2">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p dir="auto" className="break-words text-[13px] font-medium leading-[18px] text-ink">
                    {item.headline}
                  </p>
                  {item.detail && (
                    <p
                      dir="auto"
                      className="line-clamp-4 whitespace-pre-wrap break-words text-[12px] leading-[16px] text-ink-secondary"
                    >
                      {item.detail}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {canWrite && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-office-queue-quick="approve"
                    onClick={() => void sendQuickReply(t("office3d.queue.quickApprovePrompt"))}
                    className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition-colors hover:brightness-110"
                  >
                    <Check size={13} />
                    <span>{t("office3d.queue.quickApproveLabel")}</span>
                  </button>
                  <button
                    type="button"
                    data-office-queue-quick="clarify"
                    onClick={() => void sendQuickReply(t("office3d.queue.quickClarifyPrompt"))}
                    className="rounded-xl border border-hairline/70 bg-card px-3 py-1.5 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink"
                  >
                    {t("office3d.queue.quickClarifyLabel")}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 rounded-xl border border-hairline/70 bg-inset px-2.5 py-1.5 focus-within:border-accent">
                  <input
                    type="text"
                    dir="auto"
                    data-office-queue-input
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    onKeyDown={(event) => {
                      if (sendsMessage(event.nativeEvent, sendKey) && !imeComposing(event.nativeEvent)) {
                        event.preventDefault();
                        void sendQuickReply();
                      }
                    }}
                    placeholder={t("office3d.queue.replyPlaceholder", { name: botName })}
                    className="min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-tertiary focus:outline-none"
                  />
                  <button
                    type="button"
                    data-office-queue-send
                    disabled={!replyText.trim() || sendingReply}
                    onClick={() => void sendQuickReply()}
                    aria-label={t("chat.send")}
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                      replyText.trim() && !sendingReply
                        ? "bg-accent text-accent-ink hover:brightness-110"
                        : "bg-control text-ink-tertiary opacity-50",
                    )}
                  >
                    <ArrowUp size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
