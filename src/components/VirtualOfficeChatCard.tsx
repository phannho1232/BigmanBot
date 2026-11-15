import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Crown,
  ExternalLink,
  Focus,
  Loader2,
  MessageCircle,
  Plus,
  Settings,
  Square,
  Target,
  X,
} from "lucide-react";

import { BotAvatar } from "./Avatar";
import { openBotSettings } from "./bot-panel/panel-link";
import { ChatMarkdown } from "./ChatMarkdown";
import { MentionMenu, type MentionChoice } from "./MentionMenu";
import { MentionTextarea } from "./MentionTextarea";
import { useMenuMotion } from "./MenuMotion";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";
import { InstanceProviderMark, ProviderMark } from "./ProviderIcons";
import { Select } from "./Select";
import { WorkingDots } from "./WorkingIndicator";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { mentionPicksFor } from "@/lib/mention-picks";
import { mentionChoicesForQuery, mentionQueryAt, type MentionPeer } from "@/lib/mentions";
import { randomUuid } from "@/lib/random-uuid";
import { imeComposing, sendsMessage, useSendKey } from "@/lib/send-key";
import { teamMapStatus } from "@/lib/team-map";
import { useShowThreads } from "@/lib/thread-preferences";
import type { OfficeDesk } from "@/lib/virtual-office";
import { isLiveReply, stopLiveReply, StreamingReplyContext, useLiveTranscript } from "@/state/live-reply";
import {
  api,
  formatTime,
  openBot,
  useStore,
  visibleMessages,
  type Bot,
  type InstanceInfo,
  type Message,
} from "@/state/store";
import { isPureLeakedSystemHarnessMessage } from "../../shared/system-message-guard";

const MAX_DRAWN_MESSAGES = 40;

export interface VirtualOfficeChatCardProps {
  desk: OfficeDesk;
  bot: Bot;
  peers: readonly Bot[];
  botDisplayNames: Record<string, string>;
  instance: InstanceInfo | undefined;
  modelLabel: string;
  focusInputNonce: number;
  onFocusDesk: (botId: string) => void;
  onClose: () => void;
}

function isConversationalMessage(message: Message): message is Message & { text: string } {
  const body = message.text?.trim();
  if (!body) return false;
  if (message.kind === "text") {
    if (message.role === "user" && isPureLeakedSystemHarnessMessage(body)) return false;
    return message.role === "user" || message.role === "bot";
  }
  return message.kind === "activity" && message.tool?.ok === false;
}

export function VirtualOfficeChatCard({
  desk,
  bot,
  peers,
  botDisplayNames,
  instance,
  modelLabel,
  focusInputNonce,
  onFocusDesk,
  onClose,
}: VirtualOfficeChatCardProps) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const sendKey = useSendKey();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedFocusNonceRef = useRef(0);

  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [mode, setMode] = useState<"chat" | "goal">("chat");
  const [threadBusy, setThreadBusy] = useState(false);

  const draftId = `office3d:${bot.id}:${bot.threadId}`;
  const picks = useMemo(() => mentionPicksFor(draftId), [draftId]);

  const displayName = botDisplayNames[bot.id] ?? bot.name;
  const status = teamMapStatus(desk.bot);
  const canWrite = bot.yourAccess !== "view";

  const otherPeers = useMemo(
    () => peers.filter((candidate) => !candidate.hidden && candidate.id !== bot.id),
    [peers, bot.id],
  );
  const mentionPeers = useMemo<MentionPeer[]>(
    () => peers.filter((candidate) => !candidate.hidden).map((candidate) => ({
      name: candidate.name,
      color: candidate.color,
    })),
    [peers],
  );

  const allVisible = useMemo(() => visibleMessages(bot), [bot]);
  const windowed = useMemo(() => allVisible.slice(-MAX_DRAWN_MESSAGES), [allVisible]);
  const liveRows = useLiveTranscript(bot.threadId, windowed, allVisible);
  const chatRows = useMemo(() => liveRows.filter(isConversationalMessage), [liveRows]);
  const approvals = useMemo(() => pendingApprovals(allVisible), [allVisible]);

  const activeTasks = useMemo(
    () => (bot.tasks ?? []).filter((task) => !task.archivedAt),
    [bot.tasks],
  );

  useEffect(() => {
    if (!bot.unread) return;
    void api(`/api/bots/${bot.id}/read`, {
      method: "POST",
      body: JSON.stringify({ threadId: bot.threadId }),
    }).catch(() => {});
  }, [bot.id, bot.threadId, bot.unread]);

  useEffect(() => {
    if (focusInputNonce > appliedFocusNonceRef.current) {
      appliedFocusNonceRef.current = focusInputNonce;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [focusInputNonce]);

  const lastRow = chatRows.at(-1);
  const lastRowSignature = `${lastRow?.id ?? ""}:${lastRow?.text.length ?? 0}:${approvals.length}:${bot.busy ? 1 : 0}`;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [bot.id, bot.threadId, lastRowSignature]);

  const mention = mentionQueryAt(text, caret);
  const choices = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = otherPeers.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      bot: candidate,
    }));
    return mentionChoicesForQuery(pool, mention.query);
  }, [mention, dismissedAt, otherPeers]);
  const pickerOpen = choices.length > 0;
  const motion = useMenuMotion(pickerOpen);

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);
  useEffect(() => {
    if (pickerOpen) {
      listRef.current?.querySelector<HTMLElement>(`[data-mention-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, pickerOpen]);

  const pickMention = (choice: MentionChoice) => {
    if (!mention) return;
    picks.pick(choice);
    const next = `${text.slice(0, mention.start)}@${choice.name} ${text.slice(caret)}`;
    const nextCaret = mention.start + choice.name.length + 2;
    setText(next);
    setCaret(nextCaret);
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const submitMessage = useCallback(
    (overrideText?: string, overrideMode?: "chat" | "goal", explicitMentionBot?: Bot) => {
      if (!canWrite) return;
      const body = (overrideText ?? text).trim();
      if (!body) return;
      const sendMode = overrideMode ?? mode;
      const pickedIds = explicitMentionBot ? [explicitMentionBot.id] : picks.ids(body);
      dispatch({
        type: "send",
        botId: bot.id,
        threadId: bot.threadId,
        text: body,
        sendId: randomUuid(),
        mode: sendMode,
        ...(pickedIds.length > 0 ? { mentions: pickedIds } : {}),
      });
      if (overrideText === undefined) {
        setText("");
        setCaret(0);
        setDismissedAt(null);
        picks.clear();
      }
    },
    [bot.id, bot.threadId, canWrite, dispatch, mode, picks, text],
  );

  const stopTurn = useCallback(() => {
    stopLiveReply(bot.threadId);
    dispatch({ type: "interrupt", botId: bot.id, threadId: bot.threadId });
  }, [bot.id, bot.threadId, dispatch]);

  const switchThreadInPlace = async (targetThreadId: string) => {
    if (!targetThreadId || targetThreadId === bot.threadId || threadBusy) return;
    setThreadBusy(true);
    try {
      const response = await api<{ bot?: Bot }>(`/api/bots/${bot.id}/tasks/${targetThreadId}?messages=80`, {
        method: "POST",
        body: "{}",
      });
      if (response?.bot) dispatch({ type: "taskSwitched", bot: response.bot });
    } catch {
    } finally {
      setThreadBusy(false);
    }
  };

  const createNewThreadInPlace = async () => {
    if (!canWrite || threadBusy) return;
    setThreadBusy(true);
    try {
      const response = await api<{ bot?: Bot }>(`/api/bots/${bot.id}/tasks`, {
        method: "POST",
        body: "{}",
      });
      if (response?.bot) {
        dispatch({ type: "taskSwitched", bot: response.bot });
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch {
    } finally {
      setThreadBusy(false);
    }
  };

  const hasUserMessages = useMemo(
    () => chatRows.some((row) => row.role === "user"),
    [chatRows],
  );
  const syncTeammate = otherPeers[0];

  const liveActivityLine = desk.conversation?.dialogueText ?? desk.activityText;
  const canSend = canWrite && text.trim().length > 0;

  return (
    <section
      data-office-inspector={bot.id}
      aria-label={displayName}
      className="pointer-events-auto absolute bottom-4 right-4 z-30 flex max-h-[min(560px,calc(100%-2rem))] w-[392px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-hairline/70 bg-panel/95 shadow-2xl backdrop-blur-md"
    >
      <header className="shrink-0 border-b border-hairline/50 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <BotAvatar bot={bot} size={36} animated={bot.busy} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="truncate text-[14px] font-semibold text-ink">{displayName}</h2>
                {desk.role === "chief" && <Crown size={13} className="shrink-0 text-warning" />}
              </div>
              <p className="truncate text-[11px] text-ink-secondary">
                {desk.sectionName} · {desk.bot.title || (desk.role === "chief" ? t("chat.chiefOfStaff") : t("canvas.bot"))}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {canWrite && (
              <button
                type="button"
                data-office-new-thread
                disabled={threadBusy}
                onClick={() => void createNewThreadInPlace()}
                title={t("office3d.chat.newThread")}
                aria-label={t("office3d.chat.newThread")}
                className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink disabled:opacity-40"
              >
                {threadBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onFocusDesk(bot.id)}
              title={t("office3d.focusDesk")}
              aria-label={t("office3d.focusDesk")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <Focus size={14} />
            </button>
            <button
              type="button"
              onClick={() => openBotSettings(dispatch, "identity", { botId: bot.id })}
              title={t("office3d.botSettings")}
              aria-label={t("office3d.botSettings")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <Settings size={14} />
            </button>
            <button
              type="button"
              data-office-open-full-chat
              onClick={() => openBot(dispatch, bot, showThreads)}
              title={t("office3d.chat.openFullChat")}
              aria-label={t("office3d.chat.openFullChat")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <ExternalLink size={14} />
            </button>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-inset px-2.5 py-1.5 text-[11px]">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                desk.posture === "talking"
                  ? "bg-accent"
                  : status.tone === "success"
                    ? "bg-success"
                    : status.tone === "warning"
                      ? "bg-warning"
                      : status.tone === "danger"
                        ? "bg-danger"
                        : "bg-ink-secondary/40",
              )}
            />
            <span className="truncate">
              {desk.posture === "talking" && desk.conversation?.partnerBotId
                ? t("office3d.activity.talkingTo", { name: botDisplayNames[desk.conversation.partnerBotId] ?? desk.conversation.partnerBotId })
                : status.label}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-ink-secondary">
            {instance
              ? <InstanceProviderMark instance={instance} size={11} />
              : <ProviderMark driverKind="" size={11} />}
            <span className="max-w-[115px] truncate">{modelLabel || t("canvas.defaultModel")}</span>
          </span>
        </div>

        {activeTasks.length > 1 && (
          <div className="mt-2">
            <Select
              size="sm"
              className="w-full"
              aria-label={t("office3d.chat.switchThread")}
              disabled={threadBusy}
              value={bot.threadId}
              onChange={(event) => void switchThreadInPlace(event.target.value)}
            >
              {activeTasks.map((task) => (
                <option key={task.threadId} value={task.threadId}>
                  {task.title || t("task.untitledConversation")}
                </option>
              ))}
            </Select>
          </div>
        )}
      </header>

      <div
        ref={scrollRef}
        data-office-chat-messages
        className="flex min-h-[168px] flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3"
      >
        {chatRows.length === 0 ? (
          <div className="my-auto flex flex-col items-center py-4 text-center">
            <p className="max-w-[280px] text-[12px] leading-relaxed text-ink-secondary">
              {t("office3d.chat.emptyHint", { name: displayName })}
            </p>
          </div>
        ) : (
          chatRows.map((message) => {
            const streaming = isLiveReply(message);
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex flex-col items-end">
                  <div className="max-w-[86%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[12.5px] leading-relaxed text-white shadow-xs">
                    <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  </div>
                  <span className="mt-0.5 px-1 text-[10px] text-ink-tertiary">{formatTime(message.at)}</span>
                </div>
              );
            }
            if (message.kind === "activity") {
              return (
                <div
                  key={message.id}
                  className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger"
                >
                  {message.text}
                </div>
              );
            }
            return (
              <div key={message.id} className="flex flex-col items-start">
                <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-hairline/50 bg-card px-3 py-2 text-[12.5px] leading-relaxed text-ink shadow-xs">
                  <StreamingReplyContext value={streaming}>
                    <ChatMarkdown
                      text={message.text}
                      mentionPeers={mentionPeers}
                      message={streaming ? undefined : { threadId: bot.threadId, messageId: message.id }}
                    />
                  </StreamingReplyContext>
                </div>
                {!streaming && (
                  <span className="mt-0.5 px-1 text-[10px] text-ink-tertiary">{formatTime(message.at)}</span>
                )}
              </div>
            );
          })
        )}

        {(bot.busy || desk.posture === "typing" || desk.posture === "talking") && (
          <div
            data-office-live-status
            className="flex items-center gap-2 rounded-xl border border-hairline/50 bg-inset px-3 py-2 text-[11.5px] text-ink-secondary"
          >
            <WorkingDots size={4} className="text-accent" />
            <span className="min-w-0 flex-1 truncate">
              {liveActivityLine || t("office3d.activity.typing")}
            </span>
          </div>
        )}

        {canWrite && !hasUserMessages && !bot.busy && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              data-office-quick-prompt="status"
              onClick={() => submitMessage(t("office3d.chat.quickStatusPrompt"), "chat")}
              className="rounded-full border border-hairline/60 bg-card px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:border-accent/40 hover:bg-control hover:text-ink"
            >
              {t("office3d.chat.quickStatusLabel")}
            </button>
            <button
              type="button"
              data-office-quick-prompt="plan"
              onClick={() => submitMessage(t("office3d.chat.quickPlanPrompt"), "goal")}
              className="rounded-full border border-hairline/60 bg-card px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:border-accent/40 hover:bg-control hover:text-ink"
            >
              {t("office3d.chat.quickPlanLabel")}
            </button>
            {syncTeammate && (
              <button
                type="button"
                data-office-quick-prompt="sync"
                onClick={() =>
                  submitMessage(
                    t("office3d.chat.quickSyncPrompt", { name: syncTeammate.name }),
                    "chat",
                    syncTeammate,
                  )
                }
                className="rounded-full border border-hairline/60 bg-card px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:border-accent/40 hover:bg-control hover:text-ink"
              >
                {t("office3d.chat.quickSyncLabel", { name: botDisplayNames[syncTeammate.id] ?? syncTeammate.name })}
              </button>
            )}
          </div>
        )}
      </div>

      {approvals[0] && (
        <div className="shrink-0 border-t border-warning/30 bg-warning/5">
          <PendingApprovalPanel
            pending={approvals[0]}
            count={approvals.length}
            index={0}
            botName={displayName}
            actions={
              <PendingApprovalActions
                pending={approvals[0]}
                threadId={bot.threadId}
                bot={bot}
                onCancelTurn={stopTurn}
                part="primary"
                tag="office3d"
              />
            }
            more={
              <PendingApprovalActions
                pending={approvals[0]}
                threadId={bot.threadId}
                bot={bot}
                onCancelTurn={stopTurn}
                part="more"
                tag="office3d"
              />
            }
          />
        </div>
      )}

      {canWrite && (
        <div data-office-chat-composer className="shrink-0 border-t border-hairline/50 bg-inset/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-hairline/60 bg-card p-0.5 text-[11px]">
              <button
                type="button"
                data-office-mode="chat"
                aria-pressed={mode === "chat"}
                onClick={() => setMode("chat")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors",
                  mode === "chat" ? "bg-accent text-white" : "text-ink-secondary hover:text-ink",
                )}
              >
                <MessageCircle size={11} />
                {t("office3d.chat.modeChat")}
              </button>
              <button
                type="button"
                data-office-mode="goal"
                aria-pressed={mode === "goal"}
                onClick={() => setMode("goal")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors",
                  mode === "goal" ? "bg-accent text-white" : "text-ink-secondary hover:text-ink",
                )}
              >
                <Target size={11} />
                {t("office3d.chat.modeGoal")}
              </button>
            </div>

            {bot.busy && (
              <button
                type="button"
                data-office-stop-turn
                onClick={stopTurn}
                className="flex items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/20"
              >
                <Square size={10} className="fill-current" />
                {t("office3d.chat.stop")}
              </button>
            )}
          </div>

          <div className="relative flex items-end gap-1.5 rounded-xl bg-composer px-2.5 py-1.5 ring-1 ring-composer-ring">
            <MentionMenu
              listRef={listRef}
              motion={motion}
              choices={choices}
              highlight={highlight}
              everyoneCount={otherPeers.length}
              onPick={pickMention}
              onHighlight={setHighlight}
            />
            <MentionTextarea
              inputRef={inputRef}
              peers={otherPeers}
              aria-label={
                mode === "goal"
                  ? t("office3d.chat.placeholderGoal", { name: displayName })
                  : t("office3d.chat.placeholderChat", { name: displayName })
              }
              placeholder={
                mode === "goal"
                  ? t("office3d.chat.placeholderGoal", { name: displayName })
                  : t("office3d.chat.placeholderChat", { name: displayName })
              }
              dir="auto"
              rows={1}
              value={text}
              className="block max-h-28 min-h-6 w-full resize-none overflow-y-auto bg-transparent px-1 py-0.5 text-[13px] leading-5 placeholder:text-ink-secondary focus:outline-none"
              onChange={(event) => {
                setText(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
                setDismissedAt(null);
              }}
              onKeyUp={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onClick={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={(event) => {
                if (imeComposing(event.nativeEvent)) return;
                if (pickerOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlight((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    const picked = choices[highlight];
                    if (picked) pickMention(picked);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setDismissedAt(mention?.start ?? null);
                    return;
                  }
                }
                if (sendsMessage(event.nativeEvent, sendKey)) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
            />
            <button
              type="button"
              data-office-send
              disabled={!canSend}
              onClick={() => submitMessage()}
              aria-label={t("office3d.chat.send")}
              title={t("office3d.chat.send")}
              className={cn(
                "mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white transition-opacity",
                canSend ? "bg-accent hover:brightness-110" : "bg-ink-secondary/30",
              )}
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
