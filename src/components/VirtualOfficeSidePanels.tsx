import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Coins,
  Crown,
  Focus,
  MessagesSquare,
  X,
} from "lucide-react";

import { OFFICE_BOT_DRAG_MIME } from "./VirtualOfficeSceneHud";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { OfficeBotInput, OfficeDesk } from "@/lib/virtual-office";
import {
  formatCompactNumber,
  formatUsdAmount,
  type OfficeKpiAlert,
  type OfficeKpiSummary,
} from "@/lib/virtual-office-kpi";

export function VirtualOfficeRosterSidebar<T extends OfficeBotInput>({
  desks,
  botDisplayNames,
  selectedBotId,
  activePair,
  roundtableOpen,
  roundtableAttendeeIds,
  onPairBots,
  onFocusBotDesk,
}: {
  desks: readonly OfficeDesk<T>[];
  botDisplayNames: Readonly<Record<string, string>>;
  selectedBotId: string | null;
  activePair: { visitorBotId: string; hostBotId: string } | null;
  roundtableOpen: boolean;
  roundtableAttendeeIds: readonly string[];
  onPairBots: (sourceBotId: string, targetBotId: string) => void;
  onFocusBotDesk: (botId: string) => void;
}) {
  const [rosterOpen, setRosterOpen] = useState(true);
  const [rosterDragBotId, setRosterDragBotId] = useState<string | null>(null);
  const [rosterHoverBotId, setRosterHoverBotId] = useState<string | null>(null);

  if (desks.length === 0) return null;

  return (
    <aside className="pointer-events-auto absolute left-4 top-4 z-20 w-56 max-w-[calc(100%-2rem)] rounded-2xl border border-hairline/60 bg-panel/90 shadow-lg backdrop-blur-xs">
      <button
        type="button"
        onClick={() => setRosterOpen((value) => !value)}
        aria-expanded={rosterOpen}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[12px] font-semibold text-ink"
      >
        <span>{t("office3d.roster")} · {desks.length}</span>
        {rosterOpen ? <ChevronUp size={14} className="text-ink-secondary" /> : <ChevronDown size={14} className="text-ink-secondary" />}
      </button>
      {rosterOpen && (
        <div className="max-h-64 space-y-0.5 overflow-y-auto border-t border-hairline/40 p-1.5">
          {desks.map((desk) => {
            const name = botDisplayNames[desk.bot.id] ?? desk.bot.name;
            const active = selectedBotId === desk.bot.id;
            const pairActive = activePair?.visitorBotId === desk.bot.id || activePair?.hostBotId === desk.bot.id;
            const roundtableActive = roundtableOpen && roundtableAttendeeIds.includes(desk.bot.id);
            const dropHovered = rosterHoverBotId === desk.bot.id;
            return (
              <button
                key={desk.bot.id}
                type="button"
                data-office-roster-bot={desk.bot.id}
                draggable
                onDragStart={(event) => {
                  setRosterDragBotId(desk.bot.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(OFFICE_BOT_DRAG_MIME, desk.bot.id);
                  event.dataTransfer.setData("text/plain", desk.bot.id);
                }}
                onDragEnd={() => {
                  setRosterDragBotId(null);
                  setRosterHoverBotId(null);
                }}
                onDragOver={(event) => {
                  const sourceId = event.dataTransfer.getData(OFFICE_BOT_DRAG_MIME)
                    || event.dataTransfer.getData("text/plain")
                    || rosterDragBotId;
                  if (!sourceId || sourceId === desk.bot.id) return;
                  event.preventDefault();
                  setRosterHoverBotId(desk.bot.id);
                }}
                onDragLeave={() => {
                  if (rosterHoverBotId === desk.bot.id) setRosterHoverBotId(null);
                }}
                onDrop={(event) => {
                  const sourceId = event.dataTransfer.getData(OFFICE_BOT_DRAG_MIME)
                    || event.dataTransfer.getData("text/plain")
                    || rosterDragBotId;
                  setRosterHoverBotId(null);
                  setRosterDragBotId(null);
                  if (!sourceId || sourceId === desk.bot.id) return;
                  event.preventDefault();
                  onPairBots(sourceId, desk.bot.id);
                }}
                onClick={() => onFocusBotDesk(desk.bot.id)}
                className={cn(
                  "flex w-full cursor-grab items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12px] transition-colors active:cursor-grabbing",
                  dropHovered
                    ? "bg-success/20 font-medium text-ink ring-1 ring-success/50"
                    : active || pairActive || roundtableActive
                      ? "bg-accent/15 font-medium text-ink"
                      : "text-ink-secondary hover:bg-control hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    desk.posture === "talking"
                      ? "animate-pulse bg-accent"
                      : desk.posture === "typing"
                        ? "animate-pulse bg-success"
                        : desk.posture === "waiting"
                          ? "animate-pulse bg-warning"
                          : desk.posture === "offline"
                            ? "bg-danger"
                            : "bg-ink-secondary/40",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {desk.posture === "talking" && <MessagesSquare size={11} className="shrink-0 text-accent" />}
                {desk.role === "chief" && <Crown size={11} className="shrink-0 text-warning" />}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

export function VirtualOfficeKpiDrawer({
  kpi,
  onFocusWall,
  onClose,
  onSelectAlert,
  onFocusDepartmentLead,
  onOpenUsage,
  onOpenRoutines,
}: {
  kpi: OfficeKpiSummary;
  onFocusWall: () => void;
  onClose: () => void;
  onSelectAlert: (alert: OfficeKpiAlert) => void;
  onFocusDepartmentLead: (botId: string) => void;
  onOpenUsage: () => void;
  onOpenRoutines: () => void;
}) {
  return (
    <aside
      data-office-kpi-panel
      aria-label={t("office3d.kpi.panelTitle")}
      className="pointer-events-auto absolute right-4 top-4 z-20 flex max-h-[calc(100%-5.25rem)] w-92 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-hairline/60 bg-panel/95 shadow-xl backdrop-blur-xs"
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 size={15} className="shrink-0 text-accent" />
          <h2 className="truncate text-[13px] font-semibold text-ink">{t("office3d.kpi.panelTitle")}</h2>
          {kpi.isSimulatedUsage && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
              {t("office3d.kpi.demoBadge")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-office-kpi-focus-wall
            onClick={onFocusWall}
            title={t("office3d.kpi.focusWall")}
            className="flex items-center gap-1 rounded-lg border border-hairline/60 bg-card px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <Focus size={12} />
            <span>{t("office3d.kpi.focusWall")}</span>
          </button>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-lg p-1 text-ink-secondary hover:bg-control hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto p-3.5">
        {kpi.alerts.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-warning/35 bg-warning/8 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
              <AlertTriangle size={12} />
              <span>{t("office3d.kpi.alertsTitle")}</span>
            </div>
            <div className="space-y-1">
              {kpi.alerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => onSelectAlert(alert)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-panel/90 px-2.5 py-1.5 text-left text-[11px] font-medium text-ink transition-colors hover:bg-control"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("size-2 shrink-0 rounded-full", alert.severity === "danger" ? "bg-danger" : "bg-warning")} />
                    <span className="truncate">{alert.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-hairline/50 bg-card p-2.5">
            <span className="text-[11px] text-ink-secondary">{t("office3d.kpi.workforce")}</span>
            <div className="mt-1 text-[19px] font-bold leading-none text-ink">{kpi.utilizationPct}%</div>
            <div className="mt-1.5 truncate text-[11px] text-ink-secondary">
              {t("office3d.kpi.workforceSub", {
                active: kpi.activeBots,
                total: kpi.totalBots,
                ready: kpi.readyBots,
              })}
            </div>
          </div>

          <div className="rounded-xl border border-hairline/50 bg-card p-2.5">
            <span className="text-[11px] text-ink-secondary">{t("office3d.kpi.throughput")}</span>
            <div className="mt-1 text-[19px] font-bold leading-none text-ink">
              {t("office3d.kpi.throughputValue", { turns: formatCompactNumber(kpi.totalTurns) })}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-ink-secondary">
              {t("office3d.kpi.throughputSub", { done: kpi.completedThreads, open: kpi.openThreads })}
            </div>
          </div>

          <div className="rounded-xl border border-hairline/50 bg-card p-2.5">
            <span className="text-[11px] text-ink-secondary">{t("office3d.kpi.routines")}</span>
            <div className="mt-1 text-[19px] font-bold leading-none text-ink">
              {kpi.routineSuccessPct !== null
                ? `${kpi.routineSuccessPct}%`
                : kpi.enabledRoutines > 0
                  ? `${kpi.enabledRoutines}`
                  : "—"}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-ink-secondary">
              {kpi.totalRoutines > 0
                ? t("office3d.kpi.routinesSub", {
                  enabled: kpi.enabledRoutines,
                  ok: kpi.weekRunsOk,
                  total: kpi.weekRunsTotal,
                })
                : t("office3d.kpi.routinesNone")}
            </div>
          </div>

          <div className="rounded-xl border border-hairline/50 bg-card p-2.5">
            <span className="text-[11px] text-ink-secondary">{t("office3d.kpi.tokens")}</span>
            <div className="mt-1 text-[19px] font-bold leading-none text-ink">
              {formatCompactNumber(kpi.totalTokens)}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-ink-secondary">
              {t("office3d.kpi.tokensSub", {
                cache: kpi.cacheHitPct,
                cost: kpi.hasReportedCost ? formatUsdAmount(kpi.totalCostUsd) : t("office3d.kpi.costUnreported"),
              })}
            </div>
          </div>
        </div>

        {kpi.monthlyBudgetUsd !== null && kpi.budgetUsedPct !== null && (
          <div className="rounded-xl border border-hairline/50 bg-card px-3 py-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-ink">{t("office3d.kpi.budgetLabel", { pct: kpi.budgetUsedPct })}</span>
              <span className="text-ink-secondary">
                {formatUsdAmount(kpi.totalCostUsd)} / {formatUsdAmount(kpi.monthlyBudgetUsd)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-inset">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  kpi.budgetUsedPct >= 100
                    ? "bg-danger"
                    : kpi.budgetUsedPct >= kpi.budgetWarnPct
                      ? "bg-warning"
                      : "bg-success",
                )}
                style={{ width: `${Math.min(100, kpi.budgetUsedPct)}%` }}
              />
            </div>
          </div>
        )}

        {kpi.departments.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="px-0.5 text-[11px] font-semibold text-ink-secondary">
              {t("office3d.kpi.departmentsTitle")}
            </h3>
            <div className="space-y-1.5">
              {kpi.departments.map((dept) => {
                const maxDeptTokens = Math.max(1, ...kpi.departments.map((d) => d.totalTokens));
                const barPct = dept.totalTokens > 0
                  ? Math.max(12, Math.round((dept.totalTokens / maxDeptTokens) * 100))
                  : dept.activityPct;
                return (
                  <button
                    key={dept.key || "__general__"}
                    type="button"
                    onClick={() => {
                      if (dept.leadBotId) onFocusDepartmentLead(dept.leadBotId);
                    }}
                    className="block w-full rounded-xl border border-hairline/45 bg-card px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-control"
                  >
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dept.accentHex }} />
                        <span className="truncate">{dept.name}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-secondary">
                        {t("office3d.kpi.deptStats", {
                          active: dept.activeBots,
                          total: dept.totalBots,
                          turns: dept.turns,
                          tokens: formatCompactNumber(dept.totalTokens),
                        })}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-inset">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, barPct)}%`, backgroundColor: dept.accentHex }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-hairline/40 px-3.5 py-2.5">
        <button
          type="button"
          onClick={onOpenUsage}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-hairline/60 bg-card px-2.5 py-1.5 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
        >
          <Coins size={12} />
          <span>{t("office3d.kpi.openUsage")}</span>
        </button>
        <button
          type="button"
          onClick={onOpenRoutines}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-hairline/60 bg-card px-2.5 py-1.5 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
        >
          <CalendarClock size={12} />
          <span>{t("office3d.kpi.openRoutines")}</span>
        </button>
      </div>
    </aside>
  );
}
