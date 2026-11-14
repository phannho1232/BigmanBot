import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Crown,
  ExternalLink,
  Focus,
  Loader2,
  MessageCircle,
  RefreshCw,
  Square,
  Target,
  Users,
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

const MAX_DRAWN_MESSAGES = 50;

export interface RoundtableSectionOption {
  key: string;
  name: string;
  botIds: readonly string[];
}

export interface VirtualOfficeRoundtableCardProps {
  bots: readonly Bot[];
  sections: readonly RoundtableSectionOption[];
  attendeeIds: readonly string[];
  chairBotId: string | null;
  botDisplayNames: Readonly<Record<string, string>>;
  focusInputNonce: number;
  onSetAttendees: (botIds: string[]) => void;
  onToggleAttendee: (botId: string) => void;
  onCycleChair: () => void;
  onFocusTable: () => void;
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

function sameMemberSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

function findMatchingRoundtableGroup(groups: readonly Group[], memberIds: readonly string[]): Group | null {
  if (memberIds.length < 2) return null;
  const matches = groups.filter((group) => !group.dm && sameMemberSet(group.memberIds, memberIds));
  return matches[0] ?? null;
}

export function VirtualOfficeRoundtableCard({
  bots,
  sections,
  attendeeIds,
  chairBotId,
  botDisplayNames,
  focusInputNonce,
  onSetAttendees,
  onToggleAttendee,
  onCycleChair,
  onFocusTable,
  onClose,
}: VirtualOfficeRoundtableCardProps) {
  const { state, dispatch } = useStore();
  const sendKey = useSendKey();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedFocusNonceRef = useRef(0);

  const [text, setText] = useState("");
  const [mode, setMode] = useState<"chat" | "goal">("chat");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const attendees = useMemo(
    () => attendeeIds.map((id) => bots.find((bot) => bot.id === id)).filter((bot): bot is Bot => Boolean(bot)),
    [attendeeIds, bots],
  );

  const chairBot = useMemo(() => {
    if (chairBotId) {
      const explicit = attendees.find((bot) => bot.id === chairBotId);
      if (explicit) return explicit;
    }
    return attendees.find((bot) => bot.chiefOfStaff) ?? attendees[0] ?? null;
  }, [attendees, chairBotId]);

  const chairName = chairBot ? (botDisplayNames[chairBot.id] ?? chairBot.name) : "";

  const leadBots = useMemo(
    () => bots.filter((bot) => bot.chiefOfStaff),
    [bots],
  );

  const group = useMemo(
    () => findMatchingRoundtableGroup(state.groups, attendees.map((bot) => bot.id)),
    [state.groups, attendees],
  );

  const canWrite = attendees.length >= 2 && attendees.every((bot) => bot.yourAccess !== "view");
  const isWorking = Boolean(group?.working || group?.busyBotId);

  const activeSpeakerBot = useMemo(() => {
    if (!group?.busyBotId) return null;
    return bots.find((bot) => bot.id === group.busyBotId) ?? null;
  }, [group?.busyBotId, bots]);

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

  const buildRoomName = useCallback((): string => {
    const matchingDept = sections.find(
      (sec) => sec.botIds.length >= 2 && sameMemberSet(sec.botIds, attendees.map((bot) => bot.id)),
    );
    if (matchingDept) return `${t("office3d.roundtable.button")} · ${matchingDept.name}`;
    if (attendees.length === bots.length && bots.length > 2) {
      return `${t("office3d.roundtable.button")} · ${t("office3d.roundtable.allBots", { count: bots.length })}`;
    }
    const previewNames = attendees
      .slice(0, 3)
      .map((bot) => botDisplayNames[bot.id] ?? bot.name)
      .join(", ");
    return attendees.length > 3 ? `${previewNames} +${attendees.length - 3}` : previewNames;
  }, [sections, attendees, bots.length, botDisplayNames]);

  const ensureRoundtableGroup = useCallback(async (): Promise<Group | null> => {
    if (attendees.length < 2 || !chairBot) return null;
    if (group) return group;

    setCreatingRoom(true);
    setRoomError(null);
    try {
      const orderedIds = [
        chairBot.id,
        ...attendees.filter((bot) => bot.id !== chairBot.id).map((bot) => bot.id),
      ];
      const uniqueSections = [...new Set(attendees.map((bot) => bot.section?.trim() ?? "").filter(Boolean))];
      const sharedSection = uniqueSections.length === 1 ? uniqueSections[0] : undefined;

      const response = await api<{ group: Group }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          memberIds: orderedIds,
          name: buildRoomName(),
          section: sharedSection,
          setup: {
            bulletin: "",
            defaultResponder: { kind: "member", botId: chairBot.id },
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
  }, [attendees, chairBot, group, buildRoomName, dispatch]);

  const submitMessage = useCallback(
    async (rawText?: string, overrideMode?: "chat" | "goal") => {
      const baseText = (rawText ?? text).trim();
      const targetMode = overrideMode ?? mode;
      if (!baseText || !canWrite || creatingRoom) return;
      if (rawText === undefined) setText("");

      const targetGroup = await ensureRoundtableGroup();
      if (!targetGroup) return;

      const lower = baseText.toLowerCase();
      const anyExplicitMention = attendees.some((bot) => lower.includes(`@${bot.name.toLowerCase()}`));
      const mentionPrefix = targetMode === "chat" && !anyExplicitMention
        ? `${attendees.map((bot) => `@${bot.name}`).join(" ")} `
        : "";

      dispatch({
        type: "sendGroup",
        groupId: targetGroup.id,
        threadId: targetGroup.threadId,
        text: `${mentionPrefix}${baseText}`,
        mode: targetMode,
        mentions: targetMode === "chat" ? attendees.map((bot) => bot.id) : undefined,
        sendId: randomUuid(),
      });
    },
    [text, mode, canWrite, creatingRoom, ensureRoundtableGroup, attendees, dispatch],
  );

  const stopMeetingTurn = useCallback(() => {
    if (!group) return;
    stopLiveReply(group.threadId);
    dispatch({
      type: "interruptGroup",
      groupId: group.id,
      threadId: group.threadId,
    });
  }, [group, dispatch]);

  const openFullRoom = useCallback(async () => {
    const targetGroup = await ensureRoundtableGroup();
    if (!targetGroup) return;
    dispatch({ type: "select", id: targetGroup.id });
  }, [ensureRoundtableGroup, dispatch]);

  const quickTemplates = useMemo(
    () => [
      {
        key: "standup",
        label: t("office3d.roundtable.quickStandupLabel"),
        prompt: t("office3d.roundtable.quickStandupPrompt"),
        preferredMode: "chat" as const,
      },
      {
        key: "kickoff",
        label: t("office3d.roundtable.quickKickoffLabel"),
        prompt: t("office3d.roundtable.quickKickoffPrompt"),
        preferredMode: mode,
      },
      {
        key: "brainstorm",
        label: t("office3d.roundtable.quickBrainstormLabel"),
        prompt: t("office3d.roundtable.quickBrainstormPrompt"),
        preferredMode: "chat" as const,
      },
    ],
    [mode],
  );

  const resolveSpeakerBot = useCallback(
    (message: Message): Bot | null => {
      if (message.from?.botId) {
        return bots.find((candidate) => candidate.id === message.from?.botId) ?? chairBot;
      }
      return chairBot;
    },
    [bots, chairBot],
  );

  const allSelected = bots.length >= 2 && sameMemberSet(attendeeIds, bots.map((bot) => bot.id));
  const leadsSelected = leadBots.length >= 2 && sameMemberSet(attendeeIds, leadBots.map((bot) => bot.id));

  return (
    <aside
      data-office-roundtable-card
      aria-label={t("office3d.roundtable.title")}
      className="pointer-events-auto absolute bottom-4 right-4 top-4 z-30 flex w-104 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-accent/50 bg-panel/95 shadow-2xl backdrop-blur-md"
    >
      <div className="shrink-0 border-b border-hairline/50 px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Users size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[13.5px] font-semibold text-ink">
                {t("office3d.roundtable.title")}
              </h2>
              <p className="truncate text-[11px] text-ink-secondary">
                {t("office3d.roundtable.subtitle", { count: attendees.length })}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onFocusTable}
              title={t("office3d.roundtable.focusTable")}
              aria-label={t("office3d.roundtable.focusTable")}
              className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <Focus size={14} />
            </button>
            {attendees.length >= 2 && (
              <button
                type="button"
                onClick={() => void openFullRoom()}
                title={t("office3d.pair.openFullRoom")}
                aria-label={t("office3d.pair.openFullRoom")}
                className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button
              type="button"
              data-office-roundtable-adjourn
              onClick={onClose}
              title={t("office3d.roundtable.endMeeting")}
              className="flex items-center gap-1 rounded-lg border border-hairline/60 bg-card px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
            >
              <X size={13} />
              <span>{t("office3d.roundtable.endMeeting")}</span>
            </button>
          </div>
        </div>

        <div className="mt-2.5 space-y-2 rounded-xl border border-hairline/45 bg-inset/60 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-wide text-ink-secondary uppercase">
              {t("office3d.roundtable.summonLabel")}
            </span>
            {chairBot && attendees.length >= 2 && (
              <button
                type="button"
                data-office-roundtable-chair
                onClick={onCycleChair}
                title={t("office3d.roundtable.chairHint")}
                className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[10.5px] font-medium text-ink transition-colors hover:bg-control"
              >
                <Crown size={10} className="text-warning" />
                <span className="max-w-[130px] truncate">
                  {t("office3d.roundtable.chairLabel", { name: chairName })}
                </span>
                <RefreshCw size={9} className="text-ink-secondary" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {bots.length >= 2 && (
              <button
                type="button"
                data-office-roundtable-scope="all"
                onClick={() => onSetAttendees(bots.map((bot) => bot.id))}
                className={cn(
                  "rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                  allSelected
                    ? "border-accent bg-accent text-white"
                    : "border-hairline/60 bg-card text-ink-secondary hover:bg-control hover:text-ink",
                )}
              >
                {t("office3d.roundtable.allBots", { count: bots.length })}
              </button>
            )}
            {leadBots.length >= 2 && (
              <button
                type="button"
                data-office-roundtable-scope="leads"
                onClick={() => onSetAttendees(leadBots.map((bot) => bot.id))}
                className={cn(
                  "rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                  leadsSelected
                    ? "border-accent bg-accent text-white"
                    : "border-hairline/60 bg-card text-ink-secondary hover:bg-control hover:text-ink",
                )}
              >
                {t("office3d.roundtable.leadsOnly", { count: leadBots.length })}
              </button>
            )}
            {sections
              .filter((sec) => sec.botIds.length > 0)
              .map((sec) => {
                const deptActive = sec.botIds.length >= 2 && sameMemberSet(attendeeIds, sec.botIds);
                return (
                  <button
                    key={sec.key || "__general__"}
                    type="button"
                    data-office-roundtable-dept={sec.key}
                    onClick={() => {
                      if (sec.botIds.length >= 2) {
                        onSetAttendees([...sec.botIds]);
                      } else if (sec.botIds[0]) {
                        const merged = [...new Set([...attendeeIds, sec.botIds[0]])];
                        if (merged.length < 2 && bots.length >= 2) {
                          const partner = bots.find((bot) => bot.id !== sec.botIds[0]);
                          if (partner) merged.push(partner.id);
                        }
                        onSetAttendees(merged);
                      }
                    }}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                      deptActive
                        ? "border-accent bg-accent text-white"
                        : "border-hairline/60 bg-card text-ink-secondary hover:bg-control hover:text-ink",
                    )}
                  >
                    {sec.name} · {sec.botIds.length}
                  </button>
                );
              })}
          </div>

          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto pt-0.5">
            {bots.map((bot) => {
              const selected = attendeeIds.includes(bot.id);
              const isChair = chairBot?.id === bot.id && selected;
              const label = botDisplayNames[bot.id] ?? bot.name;
              return (
                <button
                  key={bot.id}
                  type="button"
                  data-office-roundtable-bot={bot.id}
                  aria-pressed={selected}
                  onClick={() => onToggleAttendee(bot.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    selected
                      ? "border-accent/60 bg-accent/15 text-ink"
                      : "border-hairline/50 bg-card/70 text-ink-secondary opacity-75 hover:opacity-100",
                  )}
                >
                  <BotAvatar bot={bot} size={15} />
                  <span className="max-w-[96px] truncate">{label}</span>
                  {isChair ? (
                    <Crown size={10} className="shrink-0 text-warning" />
                  ) : selected ? (
                    <Check size={10} className="shrink-0 text-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {roomError && (
          <p role="alert" className="mt-2 rounded-xl bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
            {roomError}
          </p>
        )}
      </div>

      <div
        ref={scrollRef}
        data-office-roundtable-messages
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3"
      >
        {attendees.length < 2 ? (
          <div className="flex h-full flex-col items-center justify-center py-6 text-center">
            <Users size={26} className="text-ink-tertiary" />
            <p className="mt-2.5 max-w-[260px] text-[12px] leading-relaxed text-ink-secondary">
              {t("office3d.roundtable.needTwoBots")}
            </p>
          </div>
        ) : displayMessages.length === 0 && !isWorking ? (
          <div className="flex h-full flex-col items-center justify-center py-4 text-center">
            <div className="flex items-center -space-x-2">
              {attendees.slice(0, 6).map((bot) => (
                <div key={bot.id} className="rounded-full ring-2 ring-panel">
                  <BotAvatar bot={bot} size={32} />
                </div>
              ))}
            </div>
            <p className="mt-3 max-w-[285px] text-[12px] leading-relaxed text-ink-secondary">
              {t("office3d.roundtable.emptyHint")}
            </p>
            {canWrite && (
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
                {quickTemplates.map((tpl) => (
                  <button
                    key={tpl.key}
                    type="button"
                    data-office-roundtable-quick={tpl.key}
                    onClick={() => void submitMessage(tpl.prompt, tpl.preferredMode)}
                    className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium text-ink transition-colors hover:border-accent/60 hover:bg-accent/20"
                  >
                    {tpl.label}
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
                      <span>{t("office3d.roundtable.modeGoal")}</span>
                    </div>
                  )}
                  {!isUser && speaker && (
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-secondary">
                      <BotAvatar bot={speaker} size={16} motion={live ? "working" : undefined} />
                      <span className="truncate text-ink">{speakerLabel}</span>
                      {chairBot?.id === speaker.id && <Crown size={10} className="shrink-0 text-warning" />}
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
            <BotAvatar bot={activeSpeakerBot ?? chairBot ?? bots[0]!} size={18} motion="working" />
            <WorkingDots />
          </div>
        )}
      </div>

      {canWrite && (
        <div className="shrink-0 border-t border-hairline/50 bg-panel/95 p-3">
          {displayMessages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {quickTemplates.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  data-office-roundtable-quick={tpl.key}
                  onClick={() => {
                    setText(tpl.prompt);
                    window.requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  className="rounded-full border border-hairline/55 bg-card px-2.5 py-1 text-[10.5px] font-medium text-ink-secondary transition-colors hover:border-accent/45 hover:bg-control hover:text-ink"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-inset p-0.5">
              <button
                type="button"
                data-office-roundtable-mode="chat"
                aria-pressed={mode === "chat"}
                onClick={() => setMode("chat")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  mode === "chat" ? "bg-card text-ink shadow-2xs" : "text-ink-secondary hover:text-ink",
                )}
              >
                <MessageCircle size={11} />
                <span>{t("office3d.roundtable.modeChat")}</span>
              </button>
              <button
                type="button"
                data-office-roundtable-mode="goal"
                aria-pressed={mode === "goal"}
                onClick={() => setMode("goal")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  mode === "goal" ? "bg-accent text-white shadow-2xs" : "text-ink-secondary hover:text-ink",
                )}
              >
                <Target size={11} />
                <span>{t("office3d.roundtable.modeGoal")}</span>
              </button>
            </div>

            {isWorking && (
              <button
                type="button"
                data-office-roundtable-stop
                onClick={stopMeetingTurn}
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
              data-office-roundtable-composer
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
                  ? t("office3d.roundtable.placeholderGoal", { chair: chairName, count: attendees.length })
                  : t("office3d.roundtable.placeholderChat", { count: attendees.length })
              }
              className="max-h-28 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent text-[12.5px] leading-snug text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
            <button
              type="button"
              data-office-roundtable-send
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
