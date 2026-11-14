import { t } from "./i18n";
import { isRoutineProblemRun, type Routine, type RoutineRun } from "./routines";
import type { OfficeBotInput, OfficePlan } from "./virtual-office";

export type OfficeKpiHealth = "healthy" | "attention" | "critical";

export interface OfficeKpiAlert {
  id: string;
  severity: "warning" | "danger";
  kind: "waiting-bot" | "offline-bot" | "routine-problem" | "budget";
  botId?: string;
  routineId?: string;
  label: string;
}

export interface OfficeDepartmentKpi {
  key: string;
  name: string;
  accentHex: string;
  leadBotId?: string;
  totalBots: number;
  activeBots: number;
  waitingBots: number;
  turns: number;
  completedThreads: number;
  openThreads: number;
  totalTokens: number;
  costUsd: number;
  activityPct: number;
}

export interface OfficeKpiSummary {
  health: OfficeKpiHealth;
  alertCount: number;
  alerts: OfficeKpiAlert[];
  totalBots: number;
  workingBots: number;
  talkingBots: number;
  activeBots: number;
  waitingBots: number;
  offlineBots: number;
  readyBots: number;
  utilizationPct: number;
  activeHandoffs: number;
  totalTurns: number;
  openThreads: number;
  completedThreads: number;
  enabledRoutines: number;
  totalRoutines: number;
  weekRunsOk: number;
  weekRunsTotal: number;
  routineSuccessPct: number | null;
  problemRoutineRuns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cacheHitPct: number;
  totalCostUsd: number;
  hasReportedCost: boolean;
  monthlyBudgetUsd: number | null;
  budgetWarnPct: number;
  budgetUsedPct: number | null;
  departments: OfficeDepartmentKpi[];
  isSimulatedUsage: boolean;
}

export interface KpiTaskLike {
  threadId: string;
  closedBy?: unknown;
  archivedAt?: number;
  openAsks?: number;
  activity?: string;
  usage?: {
    input: number;
    output: number;
    cachedInput?: number;
    costUsd: number | null;
    turns: number;
  };
}

export interface KpiBotLike extends OfficeBotInput {
  tasks?: readonly KpiTaskLike[];
}

export interface KpiGroupLike {
  id: string;
  section?: string;
  memberIds: readonly string[];
  usage?: {
    input: number;
    output: number;
    cachedInput?: number;
    costUsd: number | null;
    turns: number;
  } | null;
}

export interface BuildOfficeKpiInput<T extends KpiBotLike = KpiBotLike> {
  bots: readonly T[];
  plan: OfficePlan<OfficeBotInput>;
  botDisplayNames: Readonly<Record<string, string>>;
  groups?: readonly KpiGroupLike[];
  routines?: readonly Routine[];
  routineRuns?: readonly RoutineRun[];
  budgets?: { monthlyUsd?: number; warnAtPercent?: number };
  demoActive?: boolean;
  now?: number;
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${Math.round(value)}`;
}

export function formatUsdAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  if (value >= 100) return `$${Math.round(value)}`;
  return `$${value.toFixed(2)}`;
}

export function buildOfficeKpiSummary<T extends KpiBotLike>(input: BuildOfficeKpiInput<T>): OfficeKpiSummary {
  const {
    bots,
    plan,
    botDisplayNames,
    groups = [],
    routines = [],
    routineRuns = [],
    budgets,
    demoActive = false,
    now = Date.now(),
  } = input;

  const deskByBotId = new Map(plan.desks.map((desk) => [desk.bot.id, desk]));
  const totalBots = plan.desks.length;
  const workingBots = plan.desks.filter((desk) => desk.posture === "typing").length;
  const talkingBots = plan.desks.filter((desk) => desk.posture === "talking").length;
  const offlineBots = plan.desks.filter((desk) => desk.posture === "offline").length;

  const waitingBotIds = new Set<string>();
  const offlineBotIds = new Set<string>();

  for (const desk of plan.desks) {
    if (desk.posture === "waiting") waitingBotIds.add(desk.bot.id);
    if (desk.posture === "offline") offlineBotIds.add(desk.bot.id);
  }
  for (const bot of bots) {
    if (bot.activity === "waiting-on-you" || bot.tasks?.some((task) => (task.openAsks ?? 0) > 0 || task.activity === "waiting-on-you")) {
      waitingBotIds.add(bot.id);
    }
    if (bot.activity === "dead" || bot.activity === "no-signal") {
      offlineBotIds.add(bot.id);
    }
  }

  const waitingBots = waitingBotIds.size;
  const activeBots = workingBots + talkingBots;
  const readyBots = Math.max(0, totalBots - activeBots - waitingBots - offlineBots);
  const utilizationPct = totalBots > 0 ? Math.round((activeBots / totalBots) * 100) : 0;
  const activeHandoffs = plan.handoffs.filter((handoff) => handoff.state !== "connected").length;

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let totalTurns = 0;
  let openThreads = 0;
  let completedThreads = 0;
  let totalCostUsd = 0;
  let hasReportedCost = false;

  const botStats = new Map<string, { turns: number; completed: number; open: number; tokens: number; costUsd: number }>();

  for (const bot of bots) {
    let bTurns = 0;
    let bCompleted = 0;
    let bOpen = 0;
    let bTokens = 0;
    let bCost = 0;

    const tasks = bot.tasks ?? [];
    if (tasks.length === 0) {
      bOpen = 1;
      openThreads += 1;
    } else {
      for (const task of tasks) {
        if (task.closedBy || task.archivedAt) {
          bCompleted += 1;
          completedThreads += 1;
        } else {
          bOpen += 1;
          openThreads += 1;
        }
        if (task.usage) {
          const tIn = Math.max(0, task.usage.input || 0);
          const tOut = Math.max(0, task.usage.output || 0);
          const tCached = Math.max(0, task.usage.cachedInput || 0);
          const tTurns = Math.max(0, task.usage.turns || 0);
          inputTokens += tIn;
          outputTokens += tOut;
          cachedInputTokens += tCached;
          totalTurns += tTurns;
          bTurns += tTurns;
          bTokens += tIn + tOut;
          if (typeof task.usage.costUsd === "number" && task.usage.costUsd > 0) {
            hasReportedCost = true;
            totalCostUsd += task.usage.costUsd;
            bCost += task.usage.costUsd;
          }
        }
      }
    }

    botStats.set(bot.id, { turns: bTurns, completed: bCompleted, open: bOpen, tokens: bTokens, costUsd: bCost });
  }

  for (const group of groups) {
    if (!group.usage) continue;
    const gIn = Math.max(0, group.usage.input || 0);
    const gOut = Math.max(0, group.usage.output || 0);
    const gCached = Math.max(0, group.usage.cachedInput || 0);
    const gTurns = Math.max(0, group.usage.turns || 0);
    inputTokens += gIn;
    outputTokens += gOut;
    cachedInputTokens += gCached;
    totalTurns += gTurns;
    if (typeof group.usage.costUsd === "number" && group.usage.costUsd > 0) {
      hasReportedCost = true;
      totalCostUsd += group.usage.costUsd;
    }
  }

  const enabledRoutines = routines.filter((routine) => routine.enabled).length;
  const totalRoutines = routines.length;
  let weekRunsOk = 0;
  let weekRunsTotal = 0;
  for (const routine of routines) {
    if (routine.weekRuns) {
      weekRunsOk += routine.weekRuns.ok;
      weekRunsTotal += routine.weekRuns.total;
    }
  }

  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  if (weekRunsTotal === 0 && routineRuns.length > 0) {
    for (const run of routineRuns) {
      if (run.createdAt < sevenDaysAgo) continue;
      if (run.status === "completed") {
        weekRunsOk += 1;
        weekRunsTotal += 1;
      } else if (run.status === "failed" || run.status === "missed") {
        weekRunsTotal += 1;
      }
    }
  }

  for (const run of routineRuns) {
    if (typeof run.cost === "number" && run.cost > 0) {
      hasReportedCost = true;
      totalCostUsd += run.cost;
    }
  }

  const problemRuns = routineRuns.filter((run) => !run.seenAt && isRoutineProblemRun(run));
  const problemRoutineRuns = problemRuns.length;

  let isSimulatedUsage = false;
  let finalEnabledRoutines = enabledRoutines;
  let finalTotalRoutines = totalRoutines;
  let finalWeekOk = weekRunsOk;
  let finalWeekTotal = weekRunsTotal;

  if (demoActive && totalBots > 0 && totalTurns === 0 && inputTokens + outputTokens === 0) {
    isSimulatedUsage = true;
    const pulse = Math.floor((now / 1_800) % 40);
    totalTurns = totalBots * 14 + pulse;
    completedThreads = Math.max(3, totalBots * 3 + Math.floor(pulse / 8));
    openThreads = Math.max(totalBots, activeBots + 2);
    inputTokens = totalBots * 46_200 + pulse * 840;
    outputTokens = totalBots * 12_400 + pulse * 290;
    cachedInputTokens = Math.round(inputTokens * 0.68);
    totalCostUsd = Number(((inputTokens * 2.4 + outputTokens * 9.5) / 1_000_000).toFixed(2));
    hasReportedCost = true;
    if (finalTotalRoutines === 0) {
      finalTotalRoutines = Math.max(2, Math.min(5, totalBots));
      finalEnabledRoutines = finalTotalRoutines;
      finalWeekTotal = finalEnabledRoutines * 7;
      finalWeekOk = finalWeekTotal - 1;
    }
  }

  const totalTokens = inputTokens + outputTokens;
  const cacheHitPct = inputTokens > 0 ? Math.min(100, Math.round((cachedInputTokens / inputTokens) * 100)) : 0;
  const routineSuccessPct = finalWeekTotal > 0 ? Math.round((finalWeekOk / finalWeekTotal) * 100) : null;

  const monthlyBudgetUsd = typeof budgets?.monthlyUsd === "number" && budgets.monthlyUsd > 0
    ? budgets.monthlyUsd
    : (isSimulatedUsage ? 25 : null);
  const budgetWarnPct = budgets?.warnAtPercent ?? 80;
  const budgetUsedPct = monthlyBudgetUsd && monthlyBudgetUsd > 0
    ? Math.min(999, Math.round((totalCostUsd / monthlyBudgetUsd) * 100))
    : null;

  const alerts: OfficeKpiAlert[] = [];
  for (const botId of offlineBotIds) {
    const name = botDisplayNames[botId] ?? deskByBotId.get(botId)?.bot.name ?? botId;
    alerts.push({
      id: `offline:${botId}`,
      severity: "danger",
      kind: "offline-bot",
      botId,
      label: t("office3d.kpi.alertOffline", { name }),
    });
  }
  for (const botId of waitingBotIds) {
    if (offlineBotIds.has(botId)) continue;
    const name = botDisplayNames[botId] ?? deskByBotId.get(botId)?.bot.name ?? botId;
    alerts.push({
      id: `waiting:${botId}`,
      severity: "warning",
      kind: "waiting-bot",
      botId,
      label: t("office3d.kpi.alertWaiting", { name }),
    });
  }
  const seenRoutineAlertIds = new Set<string>();
  for (const run of problemRuns) {
    if (seenRoutineAlertIds.has(run.routineId)) continue;
    seenRoutineAlertIds.add(run.routineId);
    alerts.push({
      id: `routine:${run.routineId}`,
      severity: "danger",
      kind: "routine-problem",
      routineId: run.routineId,
      botId: run.botId,
      label: t("office3d.kpi.alertRoutine", { name: run.routineName }),
    });
  }
  if (monthlyBudgetUsd && budgetUsedPct !== null && budgetUsedPct >= budgetWarnPct) {
    alerts.push({
      id: "budget:monthly",
      severity: budgetUsedPct >= 100 ? "danger" : "warning",
      kind: "budget",
      label: t("office3d.kpi.alertBudget", {
        pct: budgetUsedPct,
        spent: formatUsdAmount(totalCostUsd),
        limit: formatUsdAmount(monthlyBudgetUsd),
      }),
    });
  }

  const hasDanger = alerts.some((alert) => alert.severity === "danger");
  const health: OfficeKpiHealth = hasDanger ? "critical" : alerts.length > 0 ? "attention" : "healthy";

  const departments: OfficeDepartmentKpi[] = plan.zones.map((zone, zIdx) => {
    const zTotal = zone.desks.length;
    const zActive = zone.desks.filter((d) => d.posture === "typing" || d.posture === "talking").length;
    const zWaiting = zone.desks.filter((d) => waitingBotIds.has(d.bot.id)).length;
    let zTurns = 0;
    let zCompleted = 0;
    let zOpen = 0;
    let zTokens = 0;
    let zCost = 0;

    zone.desks.forEach((desk, dIdx) => {
      const stats = botStats.get(desk.bot.id);
      if (isSimulatedUsage) {
        const simShare = 1 + ((zIdx * 3 + dIdx) % 3) * 0.25;
        zTurns += Math.round((totalTurns / Math.max(1, totalBots)) * simShare);
        zCompleted += Math.max(1, Math.round(completedThreads / Math.max(1, totalBots)));
        zOpen += 1;
        zTokens += Math.round((totalTokens / Math.max(1, totalBots)) * simShare);
        zCost += totalCostUsd / Math.max(1, totalBots);
      } else if (stats) {
        zTurns += stats.turns;
        zCompleted += stats.completed;
        zOpen += stats.open;
        zTokens += stats.tokens;
        zCost += stats.costUsd;
      }
    });

    const activityPct = zTotal > 0
      ? Math.max(zTurns > 0 ? 18 : 0, Math.round((zActive / zTotal) * 100))
      : 0;

    return {
      key: zone.key,
      name: zone.name,
      accentHex: zone.accentHex,
      leadBotId: zone.desks[0]?.bot.id,
      totalBots: zTotal,
      activeBots: zActive,
      waitingBots: zWaiting,
      turns: zTurns,
      completedThreads: zCompleted,
      openThreads: zOpen,
      totalTokens: zTokens,
      costUsd: zCost,
      activityPct,
    };
  });

  return {
    health,
    alertCount: alerts.length,
    alerts,
    totalBots,
    workingBots,
    talkingBots,
    activeBots,
    waitingBots,
    offlineBots,
    readyBots,
    utilizationPct,
    activeHandoffs,
    totalTurns,
    openThreads,
    completedThreads,
    enabledRoutines: finalEnabledRoutines,
    totalRoutines: finalTotalRoutines,
    weekRunsOk: finalWeekOk,
    weekRunsTotal: finalWeekTotal,
    routineSuccessPct,
    problemRoutineRuns,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    cacheHitPct,
    totalCostUsd,
    hasReportedCost,
    monthlyBudgetUsd,
    budgetWarnPct,
    budgetUsedPct,
    departments,
    isSimulatedUsage,
  };
}
