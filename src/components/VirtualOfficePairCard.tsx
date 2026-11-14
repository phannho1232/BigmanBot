import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUp,
  ExternalLink,
  Focus,
  Handshake,
  Loader2,
  MessageCircle,
  Square,
  Target,
  X,
} from "lucide-react";

import { BotAvatar } from "./Avatar";
import { ChatMarkdown } from "./ChatMarkdown";
import { WorkingDots } from "./WorkingIndicator";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { randomUuid } from "@/lib/random-uuid";
import { imeComposing, sendsMessage, useSendKey } from "@/lib/send-key";
import { isLiveReply, stopLiveReply, StreamingReplyContext, useLiveTranscript } from "@/state/live-reply";
import {
  api,
  formatTime,
  useStore,
  type Bot,
  type Group,
  type Message,
} from "@/state/store";
import { isPureLeakedSystemHarnessMessage } from "../../shared/system-message-guard";

const MAX_DRAWN_MESSAGES = 40;

export interface VirtualOfficePairCardProps {
  visitorBot: Bot;
  hostBot: Bot;
  peers: readonly Bot[];
  botDisplayNames: Readonly<Record<string, string>>;
  focusInputNonce: number;
  onSwapPair: () => void;
  onFocusDesk: (botId: string) => void;
  onClose: () => void;
}

function isRoomDisplayMessage(message: Message): message is Message & { text: string } {
  const body = message.text?.trim();
  if (!body) return false;
  if (message.kind === "text") {
    if (message.role === "user" && isPureLeakedSystemHarnessMessage(body)) return false;
    return message.role === "user" || message.role === "bot";
  }
  if (message.kind === "goal.run") return true;
  return message.kind === "activity" && message.tool?.ok === false;
}

function findMatchingPairGroup(groups: readonly Group[], botIdA: string, botIdB: string): Group | null {
  const matches = groups.filter(
    (group) =>
      group.memberIds.length === 2
      && group.memberIds.includes(botIdA)
      && group.memberIds.includes(botIdB),
  );
  if (matches.length === 0) return null;
  return matches.find((group) => !group.dm) ?? matches[0]!;
}

export function VirtualOfficePairCard({
  visitorBot,
  hostBot,
  peers,
  botDisplayNames,
  focusInputNonce,
  onSwapPair,
  onFocusDesk,
  onClose,
}: VirtualOfficePairCardProps) {
  const { state, dispatch } = useStore();
  const sendKey = useSendKey();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedFocusNonceRef = useRef(0);

  const [text, setText] = useState("");
  const [mode, setMode] = useState<"chat" | "goal">("chat");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const visitorName = botDisplayNames[visitorBot.id] ?? visitorBot.name;
  const hostName = botDisplayNames[hostBot.id] ?? hostBot.name;

  const group = useMemo(
    () => findMatchingPairGroup(state.groups, visitorBot.id, hostBot.id),
    [state.groups, visitorBot.id, hostBot.id],
  );

  const canWrite = visitorBot.yourAccess !== "view" && hostBot.yourAccess !== "view";
  const isWorking = Boolean(group?.working || group?.busyBotId);
  const activeSpeakerBot = useMemo(() => {
    if (!group?.busyBotId) return null;
    if (group.busyBotId === visitorBot.id) return visitorBot;
    if (group.busyBotId === hostBot.id) return hostBot;
    return peers.find((bot) => bot.id === group.busyBotId) ?? null;
  }, [group?.busyBotId, visitorBot, hostBot, peers]);

  const allGroupMessages = useMemo(
    () => group?.messages ?? [],
    [group?.messages],
  );
  const windowed = useMemo(
    () => allGroupMessages.slice(-MAX_DRAWN_MESSAGES),
    [allGroupMessages],
  );
  const liveMessages = useLiveTranscript(group?.threadId ?? "", windowed, allGroupMessages);
  const displayMessages = useMemo(
    () => liveMessages.filter(isRoomDisplayMessage),
    [liveMessages],
  );

  useEffect(() => {
    if (focusInputNonce === 0 || focusInputNonce === appliedFocusNonceRef.current) return;
    appliedFocusNonceRef.current = focusInputNonce;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [focusInputNonce]);

  const lastMsgKey = displayMessages.length > 0
    ? `${displayMessages[displayMessages.length - 1]!.id}:${displayMessages[displayMessages.length - 1]!.text.length}`
    : "empty";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [group?.id, lastMsgKey]);

  const ensurePairGroup = useCallback(async (): Promise<Group | null> => {
    if (group) return group;
    setCreatingRoom(true);
    setRoomError(null);
    try {
      const response = await api<{ group: Group }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          memberIds: [visitorBot.id, hostBot.id],
          name: `${visitorName} · ${hostName}`,
          section: hostBot.section || visitorBot.section || undefined,
          setup: {
            bulletin: "",
            defaultResponder: { kind: "member", botId: hostBot.id },
          },
        }),
      });
      dispatch({ type: "groupPatched", group: response.group });
      return response.group;
    } catch (cause) {
      setRoomError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setCreatingRoom(false);
    }
  }, [group, visitorBot.id, visitorBot.section, hostBot.id, hostBot.section, visitorName, hostName, dispatch]);

  const submitMessage = useCallback(
    async (rawText?: string) => {
      const baseText = (rawText ?? text).trim();
      if (!baseText || !canWrite || creatingRoom) return;
      if (rawText === undefined) setText("");

      const targetGroup = await ensurePairGroup();
      if (!targetGroup) return;

      const lower = baseText.toLowerCase();
      const mentionsVisitor = lower.includes(`@${visitorBot.name.toLowerCase()}`);
      const mentionsHost = lower.includes(`@${hostBot.name.toLowerCase()}`);
      const outgoingText = mode === "chat" && !mentionsVisitor && !mentionsHost
        ? `@${visitorBot.name} @${hostBot.name} ${baseText}`
        : baseText;

      dispatch({
        type: "sendGroup",
        groupId: targetGroup.id,
        threadId: targetGroup.threadId,
        text: outgoingText,
        mode,
        mentions: mode === "chat" ? [visitorBot.id, hostBot.id] : undefined,
        sendId: randomUuid(),
      });
    },
    [text, canWrite, creatingRoom, ensurePairGroup, mode, visitorBot.id, visitorBot.name, hostBot.id, hostBot.name, dispatch],
  );

  const stopCollaboration = useCallback(() => {
    if (!group) return;
    stopLiveReply(group.threadId);
    dispatch({
      type: "interruptGroup",
      groupId: group.id,
      threadId: group.threadId,
    });
  }, [group, dispatch]);

  const openFullRoom = useCallback(async () => {
    const targetGroup = await ensurePairGroup();
    if (!targetGroup) return;
    dispatch({ type: "select", id: targetGroup.id });
  }, [ensurePairGroup, dispatch]);

  const quickPrompts = useMemo(
    () => [
      {
        key: "collaborate",
        label: t("office3d.pair.quickCollaborateLabel"),
        prompt: t("office3d.pair.quickCollaboratePrompt", {
          visitor: visitorBot.name,
          host: hostBot.name,
        }),
      },
      {
        key: "review",
        label: t("office3d.pair.quickReviewLabel"),
        prompt: t("office3d.pair.quickReviewPrompt", {
          visitor: visitorBot.name,
          host: hostBot.name,
        }),
      },
    ],
    [visitorBot.name, hostBot.name],
  );

  const resolveSpeakerBot = useCallback(
    (message: Message): Bot => {
      if (message.from?.botId) {
        if (message.from.botId === visitorBot.id) return visitorBot;
        if (message.from.botId === hostBot.id) return hostBot;
        const found = peers.find((candidate) => candidate.id === message.from?.botId);
        if (found) return found;
      }
      return hostBot;
    },
    [visitorBot, hostBot, peers],
  );

  return (
    <aside
      data-office-pair-card
      aria-label={t("office3d.pair.title", { visitor: visitorName, host: hostName })}
      className="pointer-events-auto absolute bottom-4 right-4 top-4 z-30 flex w-96 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-accent/45 bg-panel/95 shadow-2xl backdrop-blur-md"
    >
      <div className="shrink-0 border-b border-hairline/50 px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex shrink-0 items-center -space-x-2">
              <div className="rounded-full ring-2 ring-panel">
                <BotAvatar bot={visitorBot} size={32} />
              </div>
              <div className="rounded-full ring-2 ring-panel">
                <BotAvatar bot={hostBot} size={32} />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Handshake size={13} className="shrink-0 text-accent" />
                <h2 className="truncate text-[13px] font-semibold text-ink">
                  {t("office3d.pair.title", { visitor: visitorName, host: hostName })}
                </h2>
              </div>
              <p className="truncate text-[11px] text-ink-secondary">
                {t("office3d.pair.subtitle", { visitor: visitorName, host: hostName })}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onSwapPair}
              title={t("office3d.pair.swapOrder")}
              aria-label={t("office3d.pair.swapOrder")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <ArrowLeftRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => onFocusDesk(hostBot.id)}
              title={t("office3d.focusDesk")}
              aria-label={t("office3d.focusDesk")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <Focus size={14} />
            </button>
            <button
              type="button"
              onClick={() => void openFullRoom()}
              title={t("office3d.pair.openFullRoom")}
              aria-label={t("office3d.pair.openFullRoom")}
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

        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-inset/80 px-2.5 py-1.5 text-[11px]">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
            {creatingRoom ? (
              <>
                <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
                <span className="truncate">{t("office3d.pair.creatingRoom")}</span>
              </>
            ) : isWorking ? (
              <>
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" />
                <span className="truncate">
                  {t("office3d.pair.workingStatus", {
                    name: activeSpeakerBot ? (botDisplayNames[activeSpeakerBot.id] ?? activeSpeakerBot.name) : hostName,
                  })}
                </span>
              </>
            ) : (
              <>
                <span className="size-2 shrink-0 rounded-full bg-accent" />
                <span className="truncate">{t("office3d.pair.idleStatus")}</span>
              </>
            )}
          </span>
          <span className="shrink-0 text-[10.5px] text-ink-secondary">
            {(visitorBot.section || t("settings.section.general"))} → {(hostBot.section || t("settings.section.general"))}
          </span>
        </div>

        {roomError && (
          <p role="alert" className="mt-2 rounded-xl bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
            {roomError}
          </p>
        )}
      </div>

      <div
        ref={scrollRef}
        data-office-pair-messages
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3"
      >
        {displayMessages.length === 0 && !isWorking ? (
          <div className="flex h-full flex-col items-center justify-center py-5 text-center">
            <div className="flex items-center -space-x-2">
              <div className="rounded-full ring-2 ring-panel">
                <BotAvatar bot={visitorBot} size={36} />
              </div>
              <div className="rounded-full ring-2 ring-panel">
                <BotAvatar bot={hostBot} size={36} />
              </div>
            </div>
            <p className="mt-3 max-w-[270px] text-[12px] leading-relaxed text-ink-secondary">
              {t("office3d.pair.emptyHint", { visitor: visitorName, host: hostName })}
            </p>
            {canWrite && (
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
                {quickPrompts.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    data-office-pair-quick={item.key}
                    onClick={() => void submitMessage(item.prompt)}
                    className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium text-ink transition-colors hover:border-accent/60 hover:bg-accent/20"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          displayMessages.map((message) => {
            if (message.kind === "goal.run") {
              return (
                <div
                  key={message.id}
                  className="rounded-xl border border-accent/35 bg-accent/10 px-3 py-2 text-[11.5px] font-medium text-ink"
                >
                  {message.text}
                </div>
              );
            }

            const isUser = message.role === "user";
            const live = isLiveReply(message);
            const isFailedTool = message.kind === "activity" && message.tool?.ok === false;
            const speaker = isUser ? null : resolveSpeakerBot(message);
            const speakerLabel = speaker ? (botDisplayNames[speaker.id] ?? speaker.name) : "";

            return (
              <div
                key={message.id}
                className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed",
                    isUser
                      ? "rounded-br-sm bg-accent text-white"
                      : isFailedTool
                        ? "rounded-bl-sm border border-danger/35 bg-danger/10 text-danger"
                        : "rounded-bl-sm border border-hairline/50 bg-card text-ink",
                  )}
                >
                  {isUser && message.channelMode === "goal" && (
                    <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
                      <Target size={10} />
                      <span>{t("office3d.pair.modeGoal")}</span>
                    </div>
                  )}
                  {!isUser && speaker && (
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-secondary">
                      <BotAvatar bot={speaker} size={16} motion={live ? "working" : undefined} />
                      <span className="truncate text-ink">{speakerLabel}</span>
                    </div>
                  )}
                  {isUser ? (
                    <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  ) : (
                    <StreamingReplyContext value={live}>
                      <div className="prose-sm max-w-none break-words text-[12.5px]">
                        <ChatMarkdown text={message.text} />
                      </div>
                    </StreamingReplyContext>
                  )}
                </div>
                <span className="px-1 text-[10px] text-ink-tertiary">
                  {formatTime(message.at)}
                </span>
              </div>
            );
          })
        )}

        {isWorking && !liveMessages.some(isLiveReply) && (
          <div className="flex items-center gap-2 rounded-2xl border border-hairline/45 bg-card px-3 py-2 text-[11.5px] text-ink-secondary">
            <BotAvatar bot={activeSpeakerBot ?? hostBot} size={18} motion="working" />
            <WorkingDots />
          </div>
        )}
      </div>

      {canWrite && (
        <div className="shrink-0 border-t border-hairline/50 bg-panel/95 p-3">
          {displayMessages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {quickPrompts.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  data-office-pair-quick={item.key}
                  onClick={() => {
                    setText(item.prompt);
                    window.requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  className="rounded-full border border-hairline/55 bg-card px-2.5 py-1 text-[10.5px] font-medium text-ink-secondary transition-colors hover:border-accent/45 hover:bg-control hover:text-ink"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-inset p-0.5">
              <button
                type="button"
                aria-pressed={mode === "chat"}
                onClick={() => setMode("chat")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  mode === "chat" ? "bg-card text-ink shadow-2xs" : "text-ink-secondary hover:text-ink",
                )}
              >
                <MessageCircle size={11} />
                <span>{t("office3d.pair.modeChat")}</span>
              </button>
              <button
                type="button"
                aria-pressed={mode === "goal"}
                onClick={() => setMode("goal")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  mode === "goal" ? "bg-accent text-white shadow-2xs" : "text-ink-secondary hover:text-ink",
                )}
              >
                <Target size={11} />
                <span>{t("office3d.pair.modeGoal")}</span>
              </button>
            </div>

            {isWorking && (
              <button
                type="button"
                data-office-pair-stop
                onClick={stopCollaboration}
                className="flex items-center gap-1 rounded-lg border border-danger/35 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/15"
              >
                <Square size={10} className="fill-current" />
                <span>{t("office3d.chat.stop")}</span>
              </button>
            )}
          </div>

          <div className="flex items-end gap-2 rounded-xl border border-hairline/70 bg-card px-2.5 py-2 focus-within:border-accent/60">
            <textarea
              ref={inputRef}
              rows={2}
              data-office-pair-composer
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (sendsMessage(event.nativeEvent, sendKey) && !imeComposing(event.nativeEvent)) {
                  event.preventDefault();
                  void submitMessage();
                }
              }}
              placeholder={
                mode === "goal"
                  ? t("office3d.pair.placeholderGoal", { visitor: visitorName, host: hostName })
                  : t("office3d.pair.placeholderChat", { visitor: visitorName, host: hostName })
              }
              className="max-h-28 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent text-[12.5px] leading-snug text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
            <button
              type="button"
              data-office-pair-send
              disabled={!text.trim() || creatingRoom}
              aria-label={t("office3d.chat.send")}
              title={t("office3d.chat.send")}
              onClick={() => void submitMessage()}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                text.trim() && !creatingRoom
                  ? "bg-accent text-white hover:brightness-110"
                  : "bg-control text-ink-tertiary",
              )}
            >
              {creatingRoom ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
