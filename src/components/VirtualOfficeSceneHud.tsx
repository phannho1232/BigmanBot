import { useState, type MutableRefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Compass,
  Crown,
  Handshake,
  MessageCircle,
  MessagesSquare,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Sparkles,
  Users,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { OfficeBotInput, OfficePlan } from "@/lib/virtual-office";
import { defaultBubbleForAction } from "@/lib/virtual-office-rigs";

export const OFFICE_BOT_DRAG_MIME = "application/x-office-bot-id";

export type DragDropTarget =
  | { kind: "pair"; targetBotId: string }
  | { kind: "meeting-table" }
  | { kind: "move-zone"; zoneKey: string; zoneName: string; x: number; z: number; width: number; depth: number }
  | null;

export interface DragHudState {
  sourceBotId: string;
  x: number;
  y: number;
  target: DragDropTarget;
}

export function VirtualOfficeFallback<T extends OfficeBotInput>({
  plan,
  botDisplayNames,
  roundtableAttendeeCount,
  canManage,
  onSelectMeetingTable,
  onDropBotOnMeetingTable,
  onMoveBotToSection,
  onPairBots,
  onOpenBotChat,
}: {
  plan: OfficePlan<T>;
  botDisplayNames: Readonly<Record<string, string>>;
  roundtableAttendeeCount: number;
  canManage: boolean;
  onSelectMeetingTable?: () => void;
  onDropBotOnMeetingTable?: (botId: string) => void;
  onMoveBotToSection?: (botId: string, targetSectionKey: string, targetSectionName: string) => void;
  onPairBots?: (sourceBotId: string, targetBotId: string) => void;
  onOpenBotChat: (bot: T) => void;
}) {
  const [fallbackDragBotId, setFallbackDragBotId] = useState<string | null>(null);
  const [fallbackHoverId, setFallbackHoverId] = useState<string | null>(null);

  const readDraggedBotId = (event: React.DragEvent): string | null =>
    event.dataTransfer.getData(OFFICE_BOT_DRAG_MIME)
    || event.dataTransfer.getData("text/plain")
    || fallbackDragBotId;

  return (
    <div
      role="region"
      aria-label={t("office3d.region")}
      data-office-fallback
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-app p-6"
    >
      <p className="rounded-xl border border-hairline/60 bg-panel px-4 py-3 text-[13px] text-ink-secondary">
        {t("office3d.webglUnavailable")}
      </p>
      {plan.desks.length >= 2 && (
        <button
          type="button"
          data-office-meeting-drop
          onClick={() => onSelectMeetingTable?.()}
          onDragOver={(event) => {
            const sourceId = readDraggedBotId(event);
            if (!sourceId) return;
            event.preventDefault();
            setFallbackHoverId("meeting-table");
          }}
          onDragLeave={() => {
            if (fallbackHoverId === "meeting-table") setFallbackHoverId(null);
          }}
          onDrop={(event) => {
            const sourceId = readDraggedBotId(event);
            setFallbackHoverId(null);
            setFallbackDragBotId(null);
            if (!sourceId) return;
            event.preventDefault();
            onDropBotOnMeetingTable?.(sourceId);
          }}
          className={cn(
            "inline-flex w-fit items-center gap-2 rounded-xl border px-3.5 py-2 text-[12px] font-semibold transition-colors",
            fallbackHoverId === "meeting-table" || roundtableAttendeeCount >= 2
              ? "border-accent bg-accent/15 text-ink"
              : "border-hairline/60 bg-panel text-ink-secondary hover:bg-control hover:text-ink",
          )}
        >
          <Users size={14} className="text-accent" />
          <span>
            {roundtableAttendeeCount >= 2
              ? t("office3d.roundtable.badgeActive", { count: roundtableAttendeeCount })
              : t("office3d.roundtable.badgeIdle")}
          </span>
        </button>
      )}
      {canManage && plan.zones.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {plan.zones.map((zone) => {
            const zoneHoverKey = `zone:${zone.key}`;
            return (
              <div
                key={zone.key || "__general__"}
                data-office-zone-drop={zone.key}
                onDragOver={(event) => {
                  const sourceId = readDraggedBotId(event);
                  const sourceDesk = sourceId ? plan.desks.find((item) => item.bot.id === sourceId) : null;
                  if (!sourceDesk || sourceDesk.sectionKey === zone.key) return;
                  event.preventDefault();
                  setFallbackHoverId(zoneHoverKey);
                }}
                onDragLeave={() => {
                  if (fallbackHoverId === zoneHoverKey) setFallbackHoverId(null);
                }}
                onDrop={(event) => {
                  const sourceId = readDraggedBotId(event);
                  setFallbackHoverId(null);
                  setFallbackDragBotId(null);
                  if (!sourceId) return;
                  const sourceDesk = plan.desks.find((item) => item.bot.id === sourceId);
                  if (!sourceDesk || sourceDesk.sectionKey === zone.key) return;
                  event.preventDefault();
                  onMoveBotToSection?.(sourceId, zone.key, zone.name);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors",
                  fallbackHoverId === zoneHoverKey
                    ? "border-accent bg-accent/15 text-ink"
                    : "border-hairline/60 bg-panel text-ink-secondary",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: zone.accentHex }} />
                <span>{zone.name}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plan.desks.map((desk) => {
          const name = botDisplayNames[desk.bot.id] ?? desk.bot.name;
          const bubble = defaultBubbleForAction(desk, botDisplayNames);
          const deskHoverKey = `desk:${desk.bot.id}`;
          return (
            <div
              key={desk.bot.id}
              data-office-desk={desk.bot.id}
              draggable
              onDragStart={(event) => {
                setFallbackDragBotId(desk.bot.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(OFFICE_BOT_DRAG_MIME, desk.bot.id);
                event.dataTransfer.setData("text/plain", desk.bot.id);
              }}
              onDragEnd={() => {
                setFallbackDragBotId(null);
                setFallbackHoverId(null);
              }}
              onDragOver={(event) => {
                const sourceId = readDraggedBotId(event);
                if (!sourceId || sourceId === desk.bot.id) return;
                event.preventDefault();
                setFallbackHoverId(deskHoverKey);
              }}
              onDragLeave={() => {
                if (fallbackHoverId === deskHoverKey) setFallbackHoverId(null);
              }}
              onDrop={(event) => {
                const sourceId = readDraggedBotId(event);
                setFallbackHoverId(null);
                setFallbackDragBotId(null);
                if (!sourceId || sourceId === desk.bot.id) return;
                event.preventDefault();
                onPairBots?.(sourceId, desk.bot.id);
              }}
              className={cn(
                "flex cursor-grab flex-col justify-between gap-3 rounded-2xl border bg-card p-4 shadow-xs transition-colors active:cursor-grabbing",
                fallbackHoverId === deskHoverKey ? "border-success bg-success/10" : "border-hairline/60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <span className="size-3 rounded-full" style={{ backgroundColor: desk.bodyHex }} />
                  {name}
                  {desk.role === "chief" && <Crown size={13} className="text-warning" />}
                </span>
                <span className="text-[11px] text-ink-secondary">{desk.sectionName}</span>
              </div>
              {bubble && <p className="truncate text-[12px] text-ink-secondary">{bubble}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenBotChat(desk.bot)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110"
                >
                  <MessageCircle size={13} />
                  {t("canvas.openChat")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VirtualOfficeOverlayHud<T extends OfficeBotInput>({
  plan,
  botDisplayNames,
  selectedBotId,
  roundtableAttendeeCount,
  canManage,
  dragHud,
  overlayRefs,
  zoneLabelRefs,
  meetingBadgeRef,
  onSelectBot,
  onSelectMeetingTable,
  onCameraStep,
  onResetCamera,
}: {
  plan: OfficePlan<T>;
  botDisplayNames: Readonly<Record<string, string>>;
  selectedBotId: string | null;
  roundtableAttendeeCount: number;
  canManage: boolean;
  dragHud: DragHudState | null;
  overlayRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  zoneLabelRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  meetingBadgeRef: MutableRefObject<HTMLButtonElement | null>;
  onSelectBot: (botId: string | null) => void;
  onSelectMeetingTable?: () => void;
  onCameraStep?: (deltaAzimuth: number, deltaPolar: number, zoomFactor?: number) => void;
  onResetCamera?: () => void;
}) {
  const denseOffice = plan.desks.length > 18;
  const dragSourceName = dragHud
    ? (botDisplayNames[dragHud.sourceBotId]
      ?? plan.desks.find((item) => item.bot.id === dragHud.sourceBotId)?.bot.name
      ?? "")
    : "";
  const dragTarget = dragHud?.target ?? null;
  const dragPairTargetName = dragTarget?.kind === "pair"
    ? (botDisplayNames[dragTarget.targetBotId]
      ?? plan.desks.find((item) => item.bot.id === dragTarget.targetBotId)?.bot.name
      ?? "")
    : "";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {plan.zones.map((zone) => {
        const mapKey = zone.key || "__general__";
        const zoneHighlighted = dragHud?.target?.kind === "move-zone" && dragHud.target.zoneKey === zone.key;
        return (
          <div
            key={mapKey}
            data-office-zone-label={zone.key}
            ref={(node) => {
              if (node) zoneLabelRefs.current.set(mapKey, node);
              else zoneLabelRefs.current.delete(mapKey);
            }}
            className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform"
          >
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight shadow-sm backdrop-blur-xs transition-colors",
                zoneHighlighted
                  ? "border-accent bg-accent text-white ring-2 ring-accent/35"
                  : "border-hairline/50 bg-panel/85 text-ink",
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: zoneHighlighted ? "#ffffff" : zone.accentHex }} />
              {zone.name}
            </span>
          </div>
        );
      })}

      {plan.desks.length >= 2 && (
        <button
          type="button"
          ref={meetingBadgeRef}
          data-office-meeting-badge
          onClick={() => onSelectMeetingTable?.()}
          className={cn(
            "pointer-events-auto absolute left-0 top-0 z-15 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-md backdrop-blur-xs opacity-0 transition-colors will-change-transform",
            dragTarget?.kind === "meeting-table"
              ? "scale-105 border-purple-400 bg-purple-600 text-white ring-2 ring-purple-400/40"
              : roundtableAttendeeCount >= 2
                ? "border-accent bg-accent text-white"
                : "border-hairline/60 bg-panel/90 text-ink hover:border-accent/55 hover:bg-panel",
          )}
        >
          <Users
            size={12}
            className={cn(
              "shrink-0",
              dragTarget?.kind === "meeting-table" || roundtableAttendeeCount >= 2 ? "text-white" : "text-accent",
            )}
          />
          <span>
            {roundtableAttendeeCount >= 2
              ? t("office3d.roundtable.badgeActive", { count: roundtableAttendeeCount })
              : t("office3d.roundtable.badgeIdle")}
          </span>
        </button>
      )}

      {plan.desks.map((desk) => {
        const selected = selectedBotId === desk.bot.id;
        const isPairTarget = dragHud?.target?.kind === "pair" && dragHud.target.targetBotId === desk.bot.id;
        const isDragSource = dragHud?.sourceBotId === desk.bot.id;
        const isTalking = desk.workAction === "talking";
        if (
          denseOffice
          && !selected
          && !isTalking
          && !isPairTarget
          && !isDragSource
          && (desk.posture === "idle" || desk.posture === "offline")
          && desk.role !== "chief"
        ) {
          return null;
        }
        const name = botDisplayNames[desk.bot.id] ?? desk.bot.name;
        const liveBubble = defaultBubbleForAction(desk, botDisplayNames);

        return (
          <div
            key={desk.bot.id}
            ref={(node) => {
              if (node) overlayRefs.current.set(desk.bot.id, node);
              else overlayRefs.current.delete(desk.bot.id);
            }}
            data-office-bot-pin={desk.bot.id}
            className={cn(
              "pointer-events-none absolute left-0 top-0 flex flex-col items-center gap-1 opacity-0 will-change-transform",
              (selected || isTalking || isPairTarget || isDragSource) && "z-20",
            )}
          >
            {liveBubble && (
              <button
                type="button"
                data-office-bubble={desk.bot.id}
                data-office-drag-bot={desk.bot.id}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectBot(desk.bot.id);
                  }
                }}
                className={cn(
                  "pointer-events-auto flex max-w-[230px] cursor-grab items-center gap-1.5 rounded-xl border px-2.5 py-1 text-left text-[11px] font-medium shadow-md backdrop-blur-xs transition-colors active:cursor-grabbing",
                  desk.workAction === "waiting"
                    ? "border-warning/50 bg-panel/95 text-warning"
                    : isTalking
                      ? "border-accent/55 bg-panel/95 text-ink"
                      : "border-success/45 bg-panel/95 text-ink",
                )}
              >
                {isTalking ? (
                  <MessagesSquare size={11} className="shrink-0 animate-pulse text-accent" />
                ) : (
                  <Sparkles size={11} className={cn("shrink-0", desk.workAction === "waiting" ? "text-warning" : "animate-pulse text-success")} />
                )}
                <span className="truncate">{liveBubble}</span>
              </button>
            )}

            <button
              type="button"
              data-office-drag-bot={desk.bot.id}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectBot(selected ? null : desk.bot.id);
                }
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur-xs transition-all",
                !denseOffice || selected || isTalking || isPairTarget || isDragSource || desk.posture === "waiting"
                  ? "pointer-events-auto cursor-grab active:cursor-grabbing"
                  : "pointer-events-none",
                isPairTarget
                  ? "scale-105 border-success bg-success text-white ring-2 ring-success/40"
                  : selected || isDragSource
                    ? "border-accent bg-accent text-white"
                    : "border-hairline/60 bg-card/90 text-ink hover:border-accent/50 hover:bg-card",
              )}
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  isPairTarget
                    ? "bg-white"
                    : isTalking
                      ? "animate-pulse bg-accent"
                      : desk.posture === "typing"
                        ? "animate-pulse bg-success"
                        : desk.posture === "waiting"
                          ? "animate-pulse bg-warning"
                          : desk.posture === "offline"
                            ? "bg-danger"
                            : "bg-ink-secondary/45",
                )}
              />
              <span className="max-w-[120px] truncate">{name}</span>
              {desk.role === "chief" && (
                <Crown size={11} className={cn("shrink-0", selected || isPairTarget || isDragSource ? "text-white" : "text-warning")} />
              )}
            </button>
          </div>
        );
      })}

      {dragHud && (
        <div
          data-office-drag-hud
          style={{
            transform: `translate3d(${dragHud.x.toFixed(0)}px, ${dragHud.y.toFixed(0)}px, 0) translate(-50%, calc(-100% - 18px))`,
          }}
          className={cn(
            "pointer-events-none absolute left-0 top-0 z-40 flex max-w-[310px] items-center gap-2.5 rounded-2xl border px-3 py-2 shadow-xl backdrop-blur-md",
            dragHud.target?.kind === "pair"
              ? "border-success/65 bg-panel/95 text-ink"
              : dragHud.target?.kind === "meeting-table"
                ? "border-purple-400/70 bg-panel/95 text-ink"
                : dragHud.target?.kind === "move-zone"
                  ? "border-accent/65 bg-panel/95 text-ink"
                  : "border-hairline/70 bg-panel/90 text-ink",
          )}
        >
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-xl",
              dragHud.target?.kind === "pair"
                ? "bg-success/15 text-success"
                : dragHud.target?.kind === "meeting-table"
                  ? "bg-purple-500/15 text-purple-400"
                  : dragHud.target?.kind === "move-zone"
                    ? "bg-accent/15 text-accent"
                    : "bg-control text-ink-secondary",
            )}
          >
            {dragHud.target?.kind === "move-zone" ? (
              <Building2 size={14} />
            ) : dragHud.target?.kind === "meeting-table" ? (
              <Users size={14} />
            ) : (
              <Handshake size={14} />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold">
              {dragHud.target?.kind === "pair"
                ? t("office3d.drag.pairBadge", { source: dragSourceName, target: dragPairTargetName })
                : dragHud.target?.kind === "meeting-table"
                  ? roundtableAttendeeCount >= 2
                    ? t("office3d.roundtable.dragJoin", { name: dragSourceName, count: roundtableAttendeeCount })
                    : t("office3d.roundtable.dragSummon", { name: dragSourceName })
                  : dragHud.target?.kind === "move-zone"
                    ? t("office3d.drag.moveBadge", { name: dragSourceName, team: dragHud.target.zoneName })
                    : t("office3d.drag.idleBadge", { name: dragSourceName })}
            </div>
            <div className="truncate text-[10.5px] text-ink-secondary">
              {dragHud.target?.kind === "pair"
                ? t("office3d.drag.pairSub")
                : dragHud.target?.kind === "meeting-table"
                  ? t("office3d.roundtable.dragSub")
                  : dragHud.target?.kind === "move-zone"
                    ? t("office3d.drag.moveSub")
                    : canManage
                      ? t("office3d.drag.idleSub")
                      : t("office3d.drag.idleSubPairOnly")}
            </div>
          </div>
        </div>
      )}

      {onCameraStep && (
        <div
          data-office-camera-controls
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className="pointer-events-auto absolute bottom-4 left-4 z-25 flex items-center gap-0.5 rounded-xl border border-hairline/60 bg-panel/92 p-1 shadow-lg backdrop-blur-md lg:bottom-12"
        >
          <button
            type="button"
            data-office-cam="rotate-left"
            onClick={() => onCameraStep(-Math.PI / 5, 0, 1)}
            title={t("office3d.cam.rotateLeft")}
            aria-label={t("office3d.cam.rotateLeft")}
            className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            data-office-cam="rotate-right"
            onClick={() => onCameraStep(Math.PI / 5, 0, 1)}
            title={t("office3d.cam.rotateRight")}
            aria-label={t("office3d.cam.rotateRight")}
            className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <RotateCw size={14} />
          </button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline/60" />
          <button
            type="button"
            data-office-cam="tilt-up"
            onClick={() => onCameraStep(0, -0.22, 1)}
            title={t("office3d.cam.tiltUp")}
            aria-label={t("office3d.cam.tiltUp")}
            className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            data-office-cam="tilt-down"
            onClick={() => onCameraStep(0, 0.22, 1)}
            title={t("office3d.cam.tiltDown")}
            aria-label={t("office3d.cam.tiltDown")}
            className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <ArrowDown size={14} />
          </button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline/60" />
          <button
            type="button"
            data-office-cam="zoom-in"
            onClick={() => onCameraStep(0, 0, 0.78)}
            title={t("office3d.cam.zoomIn")}
            aria-label={t("office3d.cam.zoomIn")}
            className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            data-office-cam="zoom-out"
            onClick={() => onCameraStep(0, 0, 1.28)}
            title={t("office3d.cam.zoomOut")}
            aria-label={t("office3d.cam.zoomOut")}
            className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
          >
            <Minus size={14} />
          </button>
          {onResetCamera && (
            <>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline/60" />
              <button
                type="button"
                data-office-cam="reset"
                onClick={onResetCamera}
                title={t("office3d.cam.reset")}
                aria-label={t("office3d.cam.reset")}
                className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-control hover:text-ink"
              >
                <Compass size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
