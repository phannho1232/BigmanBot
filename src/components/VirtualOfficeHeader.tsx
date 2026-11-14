import type { HTMLAttributes } from "react";
import {
  BarChart3,
  Building2,
  Compass,
  MessagesSquare,
  Moon,
  Play,
  RotateCw,
  Sun,
  SunMoon,
  Users,
  UsersRound,
} from "lucide-react";

import type { OfficeLightingMode } from "./VirtualOfficeScene";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { teamMapBotCount } from "@/lib/team-map";
import type { OfficeKpiSummary } from "@/lib/virtual-office-kpi";

export function VirtualOfficeHeader({
  dragProps,
  botCount,
  workingCount,
  talkingCount,
  activeHandoffs,
  kpi,
  roundtableOpen,
  roundtableAttendeeCount,
  kpiOpen,
  demoActive,
  remoteClient,
  showScreens,
  lightingMode,
  lightingLabel,
  autoOrbit,
  onToggleRoundtable,
  onToggleKpi,
  onToggleDemo,
  onToggleShowScreens,
  onCycleLighting,
  onToggleAutoOrbit,
  onResetCamera,
  onOpenTeamMap,
}: {
  dragProps: HTMLAttributes<HTMLElement>;
  botCount: number;
  workingCount: number;
  talkingCount: number;
  activeHandoffs: number;
  kpi: OfficeKpiSummary;
  roundtableOpen: boolean;
  roundtableAttendeeCount: number;
  kpiOpen: boolean;
  demoActive: boolean;
  remoteClient: boolean;
  showScreens: boolean;
  lightingMode: OfficeLightingMode;
  lightingLabel: string;
  autoOrbit: boolean;
  onToggleRoundtable: () => void;
  onToggleKpi: () => void;
  onToggleDemo: () => void;
  onToggleShowScreens: () => void;
  onCycleLighting: () => void;
  onToggleAutoOrbit: () => void;
  onResetCamera: () => void;
  onOpenTeamMap: () => void;
}) {
  return (
    <header {...dragProps} className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline/40 px-6 py-4 max-md:pl-12">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Building2 size={18} className="text-accent" />
          <h1 className="text-[17px] font-semibold">{t("office3d.title")}</h1>
          <span className="text-[11px] text-ink-secondary">{teamMapBotCount(botCount)}</span>
          {botCount > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                workingCount > 0 ? "bg-success/15 text-success" : "bg-control text-ink-secondary",
              )}
            >
              <span className={cn("size-1.5 rounded-full", workingCount > 0 ? "animate-pulse bg-success" : "bg-ink-secondary/45")} />
              {workingCount > 0
                ? t("office3d.workingCount", { count: workingCount })
                : talkingCount > 0
                  ? t("office3d.talkingCount", { count: talkingCount })
                  : t("office3d.allIdle")}
            </span>
          )}
          {workingCount > 0 && talkingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent">
              <MessagesSquare size={11} />
              {t("office3d.talkingCount", { count: talkingCount })}
            </span>
          )}
          {activeHandoffs > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent">
              {t("office3d.handoffActive", { count: activeHandoffs })}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] text-ink-secondary">{t("office3d.description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {botCount >= 2 && (
          <button
            type="button"
            data-office-roundtable-toggle
            onClick={onToggleRoundtable}
            aria-pressed={roundtableOpen}
            title={t("office3d.roundtable.buttonHint")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
              roundtableOpen
                ? "border-accent/50 bg-accent/15 text-ink"
                : "border-hairline/60 bg-panel text-ink-secondary hover:bg-control hover:text-ink",
            )}
          >
            <Users size={14} className={cn(roundtableOpen ? "text-accent" : "text-ink-secondary")} />
            <span>
              {roundtableOpen
                ? t("office3d.roundtable.buttonActive", { count: roundtableAttendeeCount })
                : t("office3d.roundtable.button")}
            </span>
          </button>
        )}

        {botCount > 0 && (
          <button
            type="button"
            data-office-kpi-toggle
            onClick={onToggleKpi}
            aria-pressed={kpiOpen}
            title={t("office3d.kpi.buttonHint")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
              kpiOpen
                ? "border-accent/50 bg-accent/15 text-ink"
                : "border-hairline/60 bg-panel text-ink-secondary hover:bg-control hover:text-ink",
            )}
          >
            <BarChart3 size={14} className={cn(kpiOpen ? "text-accent" : "text-ink-secondary")} />
            <span>{t("office3d.kpi.button")}</span>
            {kpi.alertCount > 0 && (
              <span
                className={cn(
                  "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-semibold text-white",
                  kpi.health === "critical" ? "bg-danger" : "bg-warning",
                )}
              >
                {kpi.alertCount}
              </span>
            )}
          </button>
        )}

        {botCount > 0 && (
          <button
            type="button"
            data-office-demo-toggle
            onClick={onToggleDemo}
            aria-pressed={demoActive}
            title={t("office3d.simulateHint")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
              demoActive
                ? "border-success/50 bg-success/15 text-success"
                : "border-hairline/60 bg-panel text-ink-secondary hover:bg-control hover:text-ink",
            )}
          >
            <Play size={13} className={cn(demoActive && "fill-current")} />
            <span>{demoActive ? t("office3d.simulating") : t("office3d.simulate")}</span>
          </button>
        )}

        {!remoteClient && (
          <button
            type="button"
            onClick={onToggleShowScreens}
            aria-pressed={showScreens}
            title={t("office3d.liveScreensHint")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
              showScreens
                ? "border-accent/40 bg-accent/10 text-ink"
                : "border-hairline/60 bg-panel text-ink-secondary hover:bg-control hover:text-ink",
            )}
          >
            <span aria-hidden className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", showScreens ? "bg-accent" : "bg-control")}>
              <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-[left]", showScreens ? "left-3.5" : "left-0.5")} />
            </span>
            {t("office3d.liveScreens")}
          </button>
        )}

        <button
          type="button"
          onClick={onCycleLighting}
          title={lightingLabel}
          aria-label={lightingLabel}
          className="flex items-center gap-1.5 rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
        >
          {lightingMode === "day" ? <Sun size={14} /> : lightingMode === "night" ? <Moon size={14} /> : <SunMoon size={14} />}
          <span className="max-sm:hidden">{lightingLabel}</span>
        </button>

        <button
          type="button"
          onClick={onToggleAutoOrbit}
          aria-pressed={autoOrbit}
          title={t("office3d.autoOrbit")}
          aria-label={t("office3d.autoOrbit")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
            autoOrbit
              ? "border-accent/40 bg-accent/10 text-ink"
              : "border-hairline/60 bg-panel text-ink-secondary hover:bg-control hover:text-ink",
          )}
        >
          <RotateCw size={14} className={cn(autoOrbit && "animate-spin [animation-duration:6s]")} />
          <span className="max-lg:hidden">{t("office3d.autoOrbit")}</span>
        </button>

        <button
          type="button"
          onClick={onResetCamera}
          title={t("office3d.resetCamera")}
          aria-label={t("office3d.resetCamera")}
          className="flex items-center gap-1.5 rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
        >
          <Compass size={14} />
          <span className="max-lg:hidden">{t("office3d.resetCamera")}</span>
        </button>

        <button
          type="button"
          onClick={onOpenTeamMap}
          className="flex items-center gap-1.5 rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-control hover:text-ink"
        >
          <UsersRound size={14} />
          <span>{t("office3d.openTeamMap")}</span>
        </button>
      </div>
    </header>
  );
}
