import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Plus } from "lucide-react";

import { ConfirmDialog } from "./ConfirmDialog";
import { useCaptionChrome } from "./DesktopCapabilities";
import {
  BotSettingsDialog,
  PublishedAppsPage,
  SettingsModal,
  TeamMapPage,
  TriggersPage,
} from "./lazy-screens";
import { MapComposer } from "./MapComposer";
import { VirtualOfficeChatCard } from "./VirtualOfficeChatCard";
import { VirtualOfficeHeader } from "./VirtualOfficeHeader";
import { VirtualOfficePairCard } from "./VirtualOfficePairCard";
import { VirtualOfficeRoundtableCard, type RoundtableSectionOption } from "./VirtualOfficeRoundtableCard";
import { VirtualOfficeScene, type OfficeLightingMode } from "./VirtualOfficeScene";
import { VirtualOfficeKpiDrawer, VirtualOfficeRosterSidebar } from "./VirtualOfficeSidePanels";
import { computerStepLine } from "@/lib/computer-step";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { t } from "@/lib/i18n";
import {
  EMPTY_TEAM_MAP_SNAPSHOT,
  buildTeamMapEdges,
  buildTeamMapSections,
  type TeamMapSnapshot,
} from "@/lib/team-map";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import {
  buildOfficePlan,
  detectOfficeConversations,
  type LiveWorkKind,
  type OfficeBotInput,
  type OfficeConversationInput,
} from "@/lib/virtual-office";
import {
  buildOfficeKpiSummary,
  type OfficeKpiAlert,
} from "@/lib/virtual-office-kpi";
import { api, useStore, type Bot, type InstanceInfo } from "@/state/store";
import { teamBotName, useTeamPeople } from "@/state/team-people";
import { turnLive } from "@/state/turn-status";

function inferToolWorkKind(toolName: string | undefined): LiveWorkKind | undefined {
  if (!toolName) return undefined;
  const lower = toolName.toLowerCase();
  if (lower.includes("computer")) return "screen";
  if (lower.includes("bash") || lower.includes("command") || lower.includes("exec") || lower.includes("terminal") || lower.includes("shell")) {
    return "command";
  }
  if (lower.includes("read") || lower.includes("grep") || lower.includes("glob") || lower.includes("search") || lower.includes("web") || lower.includes("fetch") || lower.includes("browse")) {
    return "read";
  }
  if (lower.includes("write") || lower.includes("edit") || lower.includes("patch")) {
    return "write";
  }
  return undefined;
}

function resolveLiveWorkKind(bot: Bot): LiveWorkKind | undefined {
  if (!bot.busy && bot.activity !== "working") return undefined;
  const candidateThreadIds = [
    bot.threadId,
    ...(bot.tasks?.filter((task) => task.busy).map((task) => task.threadId) ?? []),
  ];
  for (const threadId of candidateThreadIds) {
    const live = turnLive(threadId);
    if (live.status) return live.status.activity;
  }
  const lastTool = bot.messages.findLast((msg) => msg.kind === "activity" && msg.tool)?.tool;
  if (lastTool?.step?.activity) return lastTool.step.activity;
  return inferToolWorkKind(lastTool?.name);
}

function liveBotActivity(bot: Bot, instances: InstanceInfo[]): string | undefined {
  if (!bot.busy) return undefined;
  const open = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const last = !open || open.busy ? bot.messages.findLast((message) => message.kind === "activity" && message.tool) : undefined;
  if (last?.tool) return computerStepLine(last.tool) ?? activityPreview(last.tool, botEngine(bot, instances), last.dataResult);
  return bot.tasks?.find((task) => task.busy && task.threadId !== bot.threadId && task.title.trim())?.title;
}

const DEMO_WORK_KINDS: readonly LiveWorkKind[] = ["write", "read", "thinking", "command"];

const LIGHTING_CYCLE: readonly OfficeLightingMode[] = ["auto", "day", "night"];

export function VirtualOfficePage() {
  const { state, dispatch } = useStore();
  const { dragProps } = useCaptionChrome();
  const people = useTeamPeople();
  const admin = useOwnerOrAdmin();
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;

  const [snapshot, setSnapshot] = useState<TeamMapSnapshot>(EMPTY_TEAM_MAP_SNAPSHOT);
  const lastSnapshotJsonRef = useRef("");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [chatFocusNonce, setChatFocusNonce] = useState(0);
  const [activePair, setActivePair] = useState<{ visitorBotId: string; hostBotId: string } | null>(null);
  const [pairFocusNonce, setPairFocusNonce] = useState(0);
  const [roundtableOpen, setRoundtableOpen] = useState(false);
  const [roundtableAttendeeIds, setRoundtableAttendeeIds] = useState<string[]>([]);
  const [roundtableChairId, setRoundtableChairId] = useState<string | null>(null);
  const [meetingFocusNonce, setMeetingFocusNonce] = useState(0);
  const [roundtableFocusNonce, setRoundtableFocusNonce] = useState(0);
  const [pendingMove, setPendingMove] = useState<{
    bot: Bot;
    destinationKey: string;
    destinationName: string;
  } | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const [kpiOpen, setKpiOpen] = useState(false);
  const [lightingMode, setLightingMode] = useState<OfficeLightingMode>("auto");
  const [demoActive, setDemoActive] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [resetNonce, setResetNonce] = useState(0);
  const [kpiFocusNonce, setKpiFocusNonce] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ botId: string; nonce: number } | null>(null);

  const canManage = !remoteClient && admin !== false;

  const bots = useMemo(() => state.bots.filter((bot) => !bot.hidden), [state.bots]);

  const sections = useMemo(() => {
    const names = [...new Set([...(state.sections ?? []), ...state.groups.flatMap((group) => group.section ? [group.section] : [])])];
    const order = (key: string) => (key === "" ? -1 : names.includes(key) ? names.indexOf(key) : names.length);
    return buildTeamMapSections(bots, names).sort((a, b) => order(a.key) - order(b.key));
  }, [bots, state.sections, state.groups]);

  const edges = useMemo(() => buildTeamMapEdges(bots, snapshot), [bots, snapshot]);

  const refreshMapSnapshot = useCallback(async (background = false) => {
    try {
      const next = await api<TeamMapSnapshot>("/api/team-map", background ? { background } : undefined);
      const serialized = JSON.stringify(next);
      if (serialized !== lastSnapshotJsonRef.current) {
        lastSnapshotJsonRef.current = serialized;
        setSnapshot(next);
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    for (const screen of [TeamMapPage, BotSettingsDialog, SettingsModal, TriggersPage, PublishedAppsPage]) {
      void screen.preload().catch(() => {});
    }
  }, []);

  useEffect(() => {
    void refreshMapSnapshot();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshMapSnapshot(true);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [refreshMapSnapshot]);

  const botDisplayNames = useMemo(
    () => Object.fromEntries(bots.map((bot) => [bot.id, teamBotName(bot, people)])),
    [bots, people],
  );

  const realConversations = useMemo(
    () =>
      detectOfficeConversations({
        bots,
        edges,
        groups: state.groups,
        now: clockNow,
      }),
    [bots, edges, state.groups, clockNow],
  );

  const anyBusy = useMemo(
    () =>
      bots.some((bot) => bot.busy || bot.activity === "working")
      || state.groups.some((group) => group.working || Boolean(group.busyBotId)),
    [bots, state.groups],
  );
  const needsFastClock =
    demoActive
    || roundtableOpen
    || activePair !== null
    || realConversations.length > 0
    || anyBusy;

  useEffect(() => {
    const intervalMs = needsFastClock ? 1_200 : 15_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setClockNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [needsFastClock]);

  const demoOverlay = useMemo(() => {
    if (!demoActive || bots.length === 0) {
      return {
        conversations: [] as OfficeConversationInput[],
        workKinds: {} as Record<string, LiveWorkKind>,
        activities: {} as Record<string, string>,
        busyBotIds: new Set<string>(),
      };
    }

    const realTalkingIds = new Set(realConversations.flatMap((item) => item.participantBotIds));
    const available = bots.filter(
      (bot) =>
        !bot.busy
        && bot.activity !== "working"
        && bot.activity !== "waiting-on-you"
        && bot.activity !== "dead"
        && bot.activity !== "no-signal"
        && !realTalkingIds.has(bot.id),
    );

    const stage = Math.floor(clockNow / 11_000);
    const subTurn = Math.floor(clockNow / 3_600) % 2;
    const conversations: OfficeConversationInput[] = [];
    const talkingIds = new Set<string>();

    if (available.length >= 3 && stage % 3 === 2) {
      const attendees = available.slice(0, Math.min(4, available.length));
      const speaker = attendees[Math.floor(clockNow / 3_200) % attendees.length]!;
      for (const bot of attendees) talkingIds.add(bot.id);
      conversations.push({
        id: `demo-lounge-${stage}`,
        kind: "lounge-meeting",
        initiatorBotId: attendees[0]!.id,
        participantBotIds: attendees.map((bot) => bot.id),
        speakerBotId: speaker.id,
        topic: t("office3d.demo.groupSync"),
        dialogueByBotId: {
          [speaker.id]: t("office3d.demo.groupSync"),
        },
      });
    } else if (available.length >= 2) {
      const idxA = stage % available.length;
      const idxB = (idxA + 1) % available.length;
      const botA = available[idxA]!;
      const botB = available[idxB]!;
      talkingIds.add(botA.id);
      talkingIds.add(botB.id);
      const nameB = botDisplayNames[botB.id] ?? botB.name;
      conversations.push({
        id: `demo-visit-${botA.id}-${botB.id}`,
        kind: "desk-visit",
        initiatorBotId: botA.id,
        participantBotIds: [botA.id, botB.id],
        speakerBotId: subTurn === 0 ? botA.id : botB.id,
        dialogueByBotId: {
          [botA.id]: t("office3d.demo.talkAsk", { name: nameB }),
          [botB.id]: t("office3d.demo.talkReply"),
        },
      });
    }

    const workKinds: Record<string, LiveWorkKind> = {};
    const activities: Record<string, string> = {};
    const busyBotIds = new Set<string>();

    available.forEach((bot, index) => {
      if (talkingIds.has(bot.id)) return;
      const kind = DEMO_WORK_KINDS[(index + stage) % DEMO_WORK_KINDS.length]!;
      workKinds[bot.id] = kind;
      busyBotIds.add(bot.id);
      activities[bot.id] = kind === "read"
        ? t("office3d.demo.researching")
        : kind === "thinking"
          ? t("office3d.demo.thinking")
          : t("office3d.demo.coding");
    });

    return { conversations, workKinds, activities, busyBotIds };
  }, [demoActive, bots, realConversations, clockNow, botDisplayNames]);

  const effectiveSections = useMemo(() => {
    if (!demoActive || demoOverlay.busyBotIds.size === 0) return sections;
    return sections.map((section) => ({
      ...section,
      chiefs: section.chiefs.map((bot) =>
        demoOverlay.busyBotIds.has(bot.id) ? ({ ...bot, busy: true, activity: "working" as const } as Bot) : bot,
      ),
      members: section.members.map((bot) =>
        demoOverlay.busyBotIds.has(bot.id) ? ({ ...bot, busy: true, activity: "working" as const } as Bot) : bot,
      ),
    }));
  }, [sections, demoActive, demoOverlay.busyBotIds]);

  const activities = useMemo(() => {
    const entries = bots.map((bot) => [
      bot.id,
      liveBotActivity(bot, state.instances) ?? demoOverlay.activities[bot.id],
    ]);
    return Object.fromEntries(entries);
  }, [bots, state.instances, demoOverlay.activities]);

  const workKindTick = anyBusy ? clockNow : 0;
  const workKinds = useMemo(() => {
    void workKindTick;
    const entries = bots.map((bot) => [
      bot.id,
      resolveLiveWorkKind(bot) ?? demoOverlay.workKinds[bot.id],
    ]);
    return Object.fromEntries(entries);
  }, [bots, workKindTick, demoOverlay.workKinds]);

  const validRoundtableAttendeeIds = useMemo(
    () => roundtableAttendeeIds.filter((id) => bots.some((bot) => bot.id === id)),
    [roundtableAttendeeIds, bots],
  );

  const effectiveRoundtableChairId = useMemo(() => {
    if (roundtableChairId && validRoundtableAttendeeIds.includes(roundtableChairId)) {
      return roundtableChairId;
    }
    const leadId = validRoundtableAttendeeIds.find((id) => bots.find((bot) => bot.id === id)?.chiefOfStaff);
    return leadId ?? validRoundtableAttendeeIds[0] ?? null;
  }, [roundtableChairId, validRoundtableAttendeeIds, bots]);

  const roundtableSections = useMemo<RoundtableSectionOption[]>(
    () =>
      sections.map((section) => ({
        key: section.key,
        name: section.name,
        botIds: [...section.chiefs, ...section.members].map((bot) => bot.id),
      })),
    [sections],
  );

  const combinedConversations = useMemo(() => {
    const merged: OfficeConversationInput[] = [];
    if (roundtableOpen && validRoundtableAttendeeIds.length >= 2) {
      const attendeeSet = new Set(validRoundtableAttendeeIds);
      const matchingReal = realConversations.find(
        (conv) =>
          conv.participantBotIds.length === validRoundtableAttendeeIds.length
          && conv.participantBotIds.every((id) => attendeeSet.has(id)),
      );
      const rotatingSpeaker =
        validRoundtableAttendeeIds[Math.floor(clockNow / 3_200) % validRoundtableAttendeeIds.length]!;
      merged.push({
        id: "roundtable:active",
        kind: "lounge-meeting",
        initiatorBotId: effectiveRoundtableChairId ?? validRoundtableAttendeeIds[0]!,
        participantBotIds: validRoundtableAttendeeIds,
        speakerBotId: matchingReal?.speakerBotId ?? rotatingSpeaker,
        topic:
          matchingReal?.topic
          ?? t("office3d.roundtable.subtitle", { count: validRoundtableAttendeeIds.length }),
        dialogueByBotId: matchingReal?.dialogueByBotId,
      });
      for (const conv of realConversations) {
        if (conv.participantBotIds.some((id) => attendeeSet.has(id))) continue;
        merged.push(conv);
      }
    } else if (activePair) {
      const existing = realConversations.find(
        (conv) =>
          conv.participantBotIds.length === 2
          && conv.participantBotIds.includes(activePair.visitorBotId)
          && conv.participantBotIds.includes(activePair.hostBotId),
      );
      if (existing) {
        merged.push({
          ...existing,
          kind: "desk-visit",
          initiatorBotId: activePair.visitorBotId,
          participantBotIds: [activePair.visitorBotId, activePair.hostBotId],
        });
      } else {
        const subTurn = Math.floor(clockNow / 3_600) % 2;
        merged.push({
          id: `pair:${activePair.visitorBotId}:${activePair.hostBotId}`,
          kind: "desk-visit",
          initiatorBotId: activePair.visitorBotId,
          participantBotIds: [activePair.visitorBotId, activePair.hostBotId],
          speakerBotId: subTurn === 0 ? activePair.visitorBotId : activePair.hostBotId,
          topic: t("office3d.pair.subtitle", {
            visitor: botDisplayNames[activePair.visitorBotId] ?? "",
            host: botDisplayNames[activePair.hostBotId] ?? "",
          }),
        });
      }
      for (const conv of realConversations) {
        if (conv === existing) continue;
        merged.push(conv);
      }
    } else {
      merged.push(...realConversations);
    }
    merged.push(...demoOverlay.conversations);
    return merged;
  }, [
    roundtableOpen,
    validRoundtableAttendeeIds,
    effectiveRoundtableChairId,
    activePair,
    realConversations,
    demoOverlay.conversations,
    clockNow,
    botDisplayNames,
  ]);

  const plan = useMemo(
    () =>
      buildOfficePlan(effectiveSections, {
        edges,
        activities,
        workKinds,
        conversations: combinedConversations,
        startingBotIds: state.computerStarts,
      }),
    [
      effectiveSections,
      edges,
      activities,
      workKinds,
      combinedConversations,
      state.computerStarts,
    ],
  );

  const kpiBucketNow = Math.floor(clockNow / 30_000) * 30_000;
  const kpi = useMemo(
    () =>
      buildOfficeKpiSummary({
        bots,
        plan,
        botDisplayNames,
        groups: state.groups,
        routines: state.routines,
        routineRuns: state.routineRuns,
        budgets: state.config?.budgets,
        demoActive,
        now: kpiBucketNow,
      }),
    [
      bots,
      plan,
      botDisplayNames,
      state.groups,
      state.routines,
      state.routineRuns,
      state.config?.budgets,
      demoActive,
      kpiBucketNow,
    ],
  );

  const workingCount = kpi.workingBots;
  const talkingCount = kpi.talkingBots;
  const activeHandoffs = kpi.activeHandoffs;

  const selectedDesk = useMemo(
    () => (selectedBotId ? plan.desks.find((desk) => desk.bot.id === selectedBotId) ?? null : null),
    [plan.desks, selectedBotId],
  );

  const composerTeams = useMemo(
    () =>
      sections.map((section) => ({
        key: section.key,
        name: section.name,
        count: section.chiefs.length + section.members.length,
      })),
    [sections],
  );

  const handleTaggedBots = useCallback(() => {}, []);

  const selectBotInOffice = useCallback((botId: string | null) => {
    setSelectedBotId(botId);
    if (botId) {
      setActivePair(null);
      setRoundtableOpen(false);
      setKpiOpen(false);
    }
  }, []);

  const focusBotDesk = useCallback((botId: string) => {
    setSelectedBotId(botId);
    setActivePair(null);
    setRoundtableOpen(false);
    setKpiOpen(false);
    setFocusRequest((previous) => ({ botId, nonce: (previous?.nonce ?? 0) + 1 }));
    setChatFocusNonce((value) => value + 1);
  }, []);

  const handlePairBots = useCallback((sourceBotId: string, targetBotId: string) => {
    if (!sourceBotId || !targetBotId || sourceBotId === targetBotId) return;
    setSelectedBotId(null);
    setRoundtableOpen(false);
    setKpiOpen(false);
    setActivePair({ visitorBotId: sourceBotId, hostBotId: targetBotId });
    setFocusRequest((previous) => ({ botId: targetBotId, nonce: (previous?.nonce ?? 0) + 1 }));
    setPairFocusNonce((value) => value + 1);
  }, []);

  const openRoundtable = useCallback(() => {
    if (bots.length < 2) return;
    setSelectedBotId(null);
    setActivePair(null);
    setKpiOpen(false);
    setRoundtableOpen(true);
    setRoundtableAttendeeIds((current) => {
      const valid = current.filter((id) => bots.some((bot) => bot.id === id));
      if (valid.length >= 2) return valid;
      const ordered = [...bots].sort((a, b) => Number(Boolean(b.chiefOfStaff)) - Number(Boolean(a.chiefOfStaff)));
      return ordered.slice(0, Math.min(6, ordered.length)).map((bot) => bot.id);
    });
    setMeetingFocusNonce((value) => value + 1);
    setRoundtableFocusNonce((value) => value + 1);
  }, [bots]);

  const handleDropBotOnMeetingTable = useCallback(
    (botId: string) => {
      if (!botId || bots.length < 2) return;
      setSelectedBotId(null);
      setActivePair(null);
      setKpiOpen(false);
      setRoundtableOpen(true);
      setRoundtableAttendeeIds((current) => {
        const base = roundtableOpen ? current.filter((id) => bots.some((bot) => bot.id === id)) : [];
        const next = base.includes(botId) ? [...base] : [...base, botId];
        if (next.length < 2) {
          const partner =
            bots.find((bot) => bot.chiefOfStaff && bot.id !== botId)
            ?? bots.find((bot) => bot.id !== botId);
          if (partner) next.push(partner.id);
        }
        return next;
      });
      setMeetingFocusNonce((value) => value + 1);
      setRoundtableFocusNonce((value) => value + 1);
    },
    [bots, roundtableOpen],
  );

  const handleToggleRoundtableAttendee = useCallback((botId: string) => {
    setRoundtableAttendeeIds((current) =>
      current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId],
    );
  }, []);

  const handleCycleRoundtableChair = useCallback(() => {
    if (validRoundtableAttendeeIds.length < 2) return;
    const idx = effectiveRoundtableChairId ? validRoundtableAttendeeIds.indexOf(effectiveRoundtableChairId) : -1;
    const nextId = validRoundtableAttendeeIds[(idx + 1) % validRoundtableAttendeeIds.length] ?? null;
    setRoundtableChairId(nextId);
  }, [validRoundtableAttendeeIds, effectiveRoundtableChairId]);

  const handleSwapPair = useCallback(() => {
    setActivePair((current) => {
      if (!current) return null;
      const next = { visitorBotId: current.hostBotId, hostBotId: current.visitorBotId };
      setFocusRequest((previous) => ({ botId: next.hostBotId, nonce: (previous?.nonce ?? 0) + 1 }));
      return next;
    });
  }, []);

  const handleRequestMoveBot = useCallback(
    (botId: string, targetSectionKey: string, targetSectionName: string) => {
      if (!canManage) return;
      const targetBot = bots.find((item) => item.id === botId);
      if (!targetBot) return;
      const currentKey = targetBot.section?.trim() ?? "";
      if (currentKey === targetSectionKey) return;
      setPendingMove({
        bot: targetBot,
        destinationKey: targetSectionKey,
        destinationName: targetSectionName || t("settings.section.general"),
      });
    },
    [canManage, bots],
  );

  const confirmMoveBot = useCallback(async () => {
    const move = pendingMove;
    if (!move) return;
    setPendingMove(null);
    try {
      const result: { sections: string[]; bots: Bot[] } = await api("/api/sidebar-sections", {
        method: "POST",
        body: JSON.stringify({ name: move.destinationKey, botIds: [move.bot.id] }),
      });
      dispatch({ type: "sections", sections: result.sections });
      for (const patched of result.bots) {
        dispatch({ type: "botPatched", bot: patched });
      }
      const botLabel = botDisplayNames[move.bot.id] ?? move.bot.name;
      setMoveNotice(
        t("office3d.drag.movedNotice", {
          name: botLabel,
          team: move.destinationName,
        }),
      );
      setFocusRequest((previous) => ({ botId: move.bot.id, nonce: (previous?.nonce ?? 0) + 1 }));
    } catch (cause) {
      setMoveNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }, [pendingMove, dispatch, botDisplayNames]);

  useEffect(() => {
    if (!moveNotice) return;
    const timer = window.setTimeout(() => setMoveNotice(null), 3_800);
    return () => window.clearTimeout(timer);
  }, [moveNotice]);

  const activePairBots = useMemo(() => {
    if (!activePair) return null;
    const visitorBot = bots.find((item) => item.id === activePair.visitorBotId);
    const hostBot = bots.find((item) => item.id === activePair.hostBotId);
    if (!visitorBot || !hostBot) return null;
    return { visitorBot, hostBot };
  }, [activePair, bots]);

  const cycleLighting = () => {
    const nextIndex = (LIGHTING_CYCLE.indexOf(lightingMode) + 1) % LIGHTING_CYCLE.length;
    setLightingMode(LIGHTING_CYCLE[nextIndex]!);
  };

  const lightingLabel = lightingMode === "day"
    ? t("office3d.lighting.day")
    : lightingMode === "night"
      ? t("office3d.lighting.night")
      : t("office3d.lighting.auto");

  const selectedOriginalBot = useMemo(
    () => (selectedBotId ? bots.find((bot) => bot.id === selectedBotId) ?? null : null),
    [bots, selectedBotId],
  );

  const selectedInstance = selectedDesk
    ? state.instances.find((item) => item.instanceId === selectedDesk.bot.modelSelection.instanceId)
    : undefined;
  const selectedModelLabel = selectedDesk
    ? (selectedInstance?.models.options.find((item) => item.id === selectedDesk.bot.modelSelection.model)?.label
      ?? selectedDesk.bot.modelSelection.model)
    : "";

  const openInlineBotChat = useCallback(
    (botInput: OfficeBotInput) => {
      focusBotDesk(botInput.id);
    },
    [focusBotDesk],
  );

  const handleAlertClick = useCallback(
    (alert: OfficeKpiAlert) => {
      if (alert.kind === "routine-problem") {
        dispatch({
          type: "showRoutines",
          section: "logs",
          runStatus: "problems",
          routineId: alert.routineId,
        });
        return;
      }
      if (alert.kind === "budget") {
        dispatch({ type: "toggleAppSettings", open: true, section: "usage" });
        return;
      }
      if (alert.botId) {
        focusBotDesk(alert.botId);
      }
    },
    [dispatch, focusBotDesk],
  );

  return (
    <main data-virtual-office-page className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <VirtualOfficeHeader
        dragProps={dragProps}
        botCount={bots.length}
        workingCount={workingCount}
        talkingCount={talkingCount}
        activeHandoffs={activeHandoffs}
        kpi={kpi}
        roundtableOpen={roundtableOpen}
        roundtableAttendeeCount={validRoundtableAttendeeIds.length}
        kpiOpen={kpiOpen}
        demoActive={demoActive}
        lightingMode={lightingMode}
        lightingLabel={lightingLabel}
        onToggleRoundtable={() => {
          if (roundtableOpen) setRoundtableOpen(false);
          else openRoundtable();
        }}
        onToggleKpi={() =>
          setKpiOpen((value) => {
            const next = !value;
            if (next) {
              setSelectedBotId(null);
              setActivePair(null);
              setRoundtableOpen(false);
            }
            return next;
          })
        }
        onToggleDemo={() => setDemoActive((value) => !value)}
        onCycleLighting={cycleLighting}
        onResetCamera={() => {
          setSelectedBotId(null);
          setResetNonce((value) => value + 1);
        }}
        onOpenTeamMap={() => dispatch({ type: "showTeamMap" })}
      />

      <div className="relative flex min-h-0 flex-1">
        <VirtualOfficeScene
          plan={plan}
          kpi={kpi}
          botDisplayNames={botDisplayNames}
          selectedBotId={selectedBotId}
          lightingMode={lightingMode}
          resetNonce={resetNonce}
          kpiFocusNonce={kpiFocusNonce}
          meetingFocusNonce={meetingFocusNonce}
          roundtableAttendeeCount={roundtableOpen ? validRoundtableAttendeeIds.length : 0}
          focusRequest={focusRequest}
          canManage={canManage}
          onSelectBot={selectBotInOffice}
          onOpenBotChat={openInlineBotChat}
          onPairBots={handlePairBots}
          onMoveBotToSection={handleRequestMoveBot}
          onSelectMeetingTable={openRoundtable}
          onDropBotOnMeetingTable={handleDropBotOnMeetingTable}
          onSelectKpiWall={() => {
            setSelectedBotId(null);
            setActivePair(null);
            setRoundtableOpen(false);
            setKpiOpen(true);
          }}
        />

        {moveNotice && (
          <div
            role="status"
            data-office-move-notice
            className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-accent/45 bg-panel/95 px-4 py-1.5 text-[12px] font-medium text-ink shadow-lg backdrop-blur-xs"
          >
            {moveNotice}
          </div>
        )}

        {bots.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
            <div className="pointer-events-auto flex max-w-sm flex-col items-center rounded-2xl border border-hairline/60 bg-panel/95 p-6 text-center shadow-xl backdrop-blur-xs">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Building2 size={22} />
              </div>
              <h2 className="mt-3 text-[15px] font-semibold text-ink">{t("office3d.emptyTitle")}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{t("office3d.emptyBody")}</p>
              {admin !== false && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "newBot" })}
                  className="mt-4 flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
                >
                  <Plus size={15} />
                  {t("office3d.newBot")}
                </button>
              )}
            </div>
          </div>
        )}

        <VirtualOfficeRosterSidebar
          desks={plan.desks}
          botDisplayNames={botDisplayNames}
          selectedBotId={selectedBotId}
          activePair={activePair}
          roundtableOpen={roundtableOpen}
          roundtableAttendeeIds={validRoundtableAttendeeIds}
          onPairBots={handlePairBots}
          onFocusBotDesk={focusBotDesk}
        />

        {kpiOpen && bots.length > 0 && (
          <VirtualOfficeKpiDrawer
            kpi={kpi}
            onFocusWall={() => setKpiFocusNonce((value) => value + 1)}
            onClose={() => setKpiOpen(false)}
            onSelectAlert={handleAlertClick}
            onFocusDepartmentLead={focusBotDesk}
            onOpenUsage={() => dispatch({ type: "toggleAppSettings", open: true, section: "usage" })}
            onOpenRoutines={() => dispatch({ type: "showRoutines" })}
          />
        )}

        {roundtableOpen && bots.length >= 2 && (
          <VirtualOfficeRoundtableCard
            bots={bots}
            sections={roundtableSections}
            attendeeIds={validRoundtableAttendeeIds}
            chairBotId={effectiveRoundtableChairId}
            botDisplayNames={botDisplayNames}
            focusInputNonce={roundtableFocusNonce}
            onSetAttendees={(ids) => {
              setRoundtableAttendeeIds(ids);
              setMeetingFocusNonce((value) => value + 1);
            }}
            onToggleAttendee={handleToggleRoundtableAttendee}
            onCycleChair={handleCycleRoundtableChair}
            onFocusTable={() => setMeetingFocusNonce((value) => value + 1)}
            onClose={() => setRoundtableOpen(false)}
          />
        )}

        {activePairBots && !roundtableOpen && (
          <VirtualOfficePairCard
            visitorBot={activePairBots.visitorBot}
            hostBot={activePairBots.hostBot}
            peers={bots}
            botDisplayNames={botDisplayNames}
            focusInputNonce={pairFocusNonce}
            onSwapPair={handleSwapPair}
            onFocusDesk={(botId) => {
              setFocusRequest((previous) => ({ botId, nonce: (previous?.nonce ?? 0) + 1 }));
            }}
            onClose={() => setActivePair(null)}
          />
        )}

        {selectedDesk && selectedOriginalBot && !activePairBots && !roundtableOpen && (
          <VirtualOfficeChatCard
            desk={selectedDesk}
            bot={selectedOriginalBot}
            peers={bots}
            botDisplayNames={botDisplayNames}
            instance={selectedInstance}
            modelLabel={selectedModelLabel}
            focusInputNonce={chatFocusNonce}
            onFocusDesk={focusBotDesk}
            onClose={() => setSelectedBotId(null)}
          />
        )}

        {bots.length > 0 && !selectedDesk && !activePairBots && !roundtableOpen && (
          <MapComposer
            bots={bots}
            teams={composerTeams}
            onTagged={handleTaggedBots}
            onSent={(sentBotIds) => {
              if (sentBotIds.length === 1 && sentBotIds[0]) {
                focusBotDesk(sentBotIds[0]);
              } else if (sentBotIds.length === 2 && sentBotIds[0] && sentBotIds[1]) {
                handlePairBots(sentBotIds[0], sentBotIds[1]);
              } else if (sentBotIds.length >= 3) {
                setSelectedBotId(null);
                setActivePair(null);
                setKpiOpen(false);
                setRoundtableAttendeeIds(sentBotIds);
                setRoundtableOpen(true);
                setMeetingFocusNonce((value) => value + 1);
              }
            }}
          />
        )}

        <ConfirmDialog
          open={pendingMove !== null}
          tone="neutral"
          title={t("canvas.moveConfirmTitle", {
            name: pendingMove ? (botDisplayNames[pendingMove.bot.id] ?? pendingMove.bot.name) : t("canvas.bot"),
            team: pendingMove?.destinationName ?? t("settings.section.general"),
          })}
          body={t("canvas.moveConfirmBody")}
          confirmLabel={t("canvas.moveConfirm")}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => void confirmMoveBot()}
        />

        <div className="pointer-events-none absolute bottom-3 left-4 flex justify-start max-lg:hidden">
          <p className="rounded-xl border border-hairline/40 bg-panel/80 px-3 py-1.5 text-[11px] text-ink-secondary backdrop-blur-xs">
            {t("office3d.controlsHint")}
          </p>
        </div>
      </div>
    </main>
  );
}
