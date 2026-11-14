import { describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { buildTeamMapSections } from "./team-map";
import { buildOfficePlan } from "./virtual-office";
import {
  buildOfficeKpiSummary,
  formatCompactNumber,
  formatUsdAmount,
  type KpiBotLike,
} from "./virtual-office-kpi";
import type { Routine, RoutineRun } from "./routines";

describe("virtual-office-kpi", () => {
  it("aggregates real usage, routine reliability, alerts, budget status, and department output", () => {
    setLocale("vi");
    const bots: KpiBotLike[] = [
      {
        id: "lead",
        name: "Minh Quân",
        section: "Kỹ thuật",
        chiefOfStaff: true,
        busy: true,
        activity: "working",
        color: "yellow",
        tasks: [
          {
            threadId: "t-1",
            usage: { input: 50_000, output: 12_000, cachedInput: 35_000, costUsd: 0.42, turns: 8 },
          },
          {
            threadId: "t-2",
            closedBy: { botId: "lead", name: "Minh Quân", at: 1_700_000_000_000 },
            usage: { input: 30_000, output: 8_000, cachedInput: 15_000, costUsd: 0.28, turns: 5 },
          },
        ],
      },
      {
        id: "mkt",
        name: "Gia Hân",
        section: "Marketing",
        busy: false,
        activity: "waiting-on-you",
        color: "coral",
        tasks: [
          {
            threadId: "t-3",
            openAsks: 1,
            usage: { input: 20_000, output: 5_000, cachedInput: 10_000, costUsd: 0.18, turns: 3 },
          },
        ],
      },
    ];

    const sections = buildTeamMapSections(bots, ["Kỹ thuật", "Marketing"]);
    const plan = buildOfficePlan(sections);

    const routines: Routine[] = [
      {
        id: "r-1",
        name: "Báo cáo sáng",
        prompt: "Tổng hợp",
        target: "bot",
        botId: "lead",
        runOn: "maus",
        enabled: true,
        schedule: { type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] },
        durationMinutes: 15,
        weekRuns: { ok: 9, total: 10 },
        nextRunAt: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    ];

    const routineRuns: RoutineRun[] = [
      {
        id: "run-fail",
        routineId: "r-1",
        routineName: "Báo cáo sáng",
        target: "bot",
        botId: "lead",
        runOn: "maus",
        scheduledFor: 1_700_000_000_000,
        status: "failed",
        manual: false,
        cost: 0.04,
        createdAt: 1_700_000_000_000,
      },
    ];

    const kpi = buildOfficeKpiSummary({
      bots,
      plan,
      botDisplayNames: { lead: "Minh Quân", mkt: "Gia Hân" },
      routines,
      routineRuns,
      budgets: { monthlyUsd: 1.0, warnAtPercent: 80 },
      now: 1_700_000_050_000,
    });

    expect(kpi.isSimulatedUsage).toBe(false);
    expect(kpi.totalBots).toBe(2);
    expect(kpi.workingBots).toBe(1);
    expect(kpi.waitingBots).toBe(1);
    expect(kpi.utilizationPct).toBe(50);
    expect(kpi.totalTurns).toBe(16);
    expect(kpi.completedThreads).toBe(1);
    expect(kpi.openThreads).toBe(2);
    expect(kpi.totalTokens).toBe(125_000);
    expect(kpi.cacheHitPct).toBe(60);
    expect(kpi.totalCostUsd).toBeCloseTo(0.92, 2);
    expect(kpi.budgetUsedPct).toBe(92);
    expect(kpi.routineSuccessPct).toBe(90);
    expect(kpi.problemRoutineRuns).toBe(1);
    expect(kpi.health).toBe("critical");
    expect(kpi.alerts.map((a) => a.kind)).toEqual(["waiting-bot", "routine-problem", "budget"]);
    expect(kpi.departments).toHaveLength(2);
    expect(formatCompactNumber(kpi.totalTokens)).toBe("125K");
    expect(formatUsdAmount(kpi.totalCostUsd)).toBe("$0.92");
    setLocale("en");
  });

  it("provides simulated usage metrics in demo mode only when real usage is zero", () => {
    const bots: KpiBotLike[] = [
      { id: "a", name: "Atlas", section: "Tech", busy: true, activity: "working" },
      { id: "b", name: "Luna", section: "Tech", busy: false, activity: "idle" },
    ];
    const plan = buildOfficePlan(buildTeamMapSections(bots, ["Tech"]));
    const demoKpi = buildOfficeKpiSummary({
      bots,
      plan,
      botDisplayNames: { a: "Atlas", b: "Luna" },
      demoActive: true,
      now: 1_700_000_000_000,
    });

    expect(demoKpi.isSimulatedUsage).toBe(true);
    expect(demoKpi.totalTurns).toBeGreaterThan(0);
    expect(demoKpi.totalTokens).toBeGreaterThan(50_000);
    expect(demoKpi.routineSuccessPct).not.toBeNull();
  });
});
