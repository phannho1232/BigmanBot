import * as THREE from "three";

import { t } from "@/lib/i18n";
import type { OfficeDesk, OfficeWorkAction } from "@/lib/virtual-office";
import {
  formatCompactNumber,
  formatUsdAmount,
  type OfficeKpiSummary,
} from "@/lib/virtual-office-kpi";

export interface KpiWallRig {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  beaconMat: THREE.MeshBasicMaterial;
}

export function drawProceduralMonitorScreen(
  canvas: HTMLCanvasElement,
  accentHex: string,
  screenState: OfficeDesk["screenState"],
  workAction: OfficeWorkAction,
  tick: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = screenState === "off" ? "#0b0f17" : "#0f172a";
  ctx.fillRect(0, 0, w, h);

  if (screenState === "off") {
    ctx.fillStyle = "rgba(148, 163, 184, 0.14)";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, w, 22);
  const dots = ["#ef4444", "#f59e0b", "#10b981"];
  dots.forEach((color, idx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(14 + idx * 12, 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  if (workAction === "waiting") {
    ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
    ctx.fillRect(22, 38, w - 44, h - 60);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.strokeRect(22, 38, w - 44, h - 60);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(40, 56, w * 0.48, 10);
    ctx.fillStyle = "rgba(254, 243, 199, 0.7)";
    ctx.fillRect(40, 76, w * 0.62, 8);
    ctx.fillRect(40, 92, w * 0.38, 8);
    return;
  }

  if (screenState === "starting") {
    const barW = w * 0.56;
    const x0 = (w - barW) / 2;
    const progress = (tick * 0.45) % 1;
    ctx.fillStyle = "rgba(148, 163, 184, 0.2)";
    ctx.fillRect(x0, h / 2 - 5, barW, 10);
    ctx.fillStyle = accentHex;
    ctx.fillRect(x0, h / 2 - 5, barW * (0.25 + 0.75 * progress), 10);
    return;
  }

  if (workAction === "terminal") {
    ctx.fillStyle = "#050b14";
    ctx.fillRect(10, 28, w - 20, h - 38);
    const scroll = Math.floor(tick * 4);
    for (let row = 0; row < 7; row++) {
      const y = 36 + row * 16;
      ctx.fillStyle = row % 3 === 0 ? "#22c55e" : "#94a3b8";
      ctx.fillRect(20, y, 14, 7);
      const ratio = 0.28 + (((row * 7 + scroll) % 9) * 0.06);
      ctx.fillStyle = row === 6 ? "#38bdf8" : "rgba(74, 222, 128, 0.78)";
      ctx.fillRect(42, y, (w - 66) * ratio, 7);
    }
    return;
  }

  if (workAction === "researching") {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(16, 30, w - 32, h - 42);
    ctx.fillStyle = accentHex;
    ctx.fillRect(28, 42, w * 0.44, 12);
    ctx.fillStyle = "#cbd5e1";
    for (let row = 0; row < 4; row++) {
      ctx.fillRect(28, 64 + row * 15, w * (row % 2 === 0 ? 0.52 : 0.4), 7);
    }
    ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
    ctx.fillRect(w - 96, 62, 64, 62);
    return;
  }

  if (workAction === "thinking") {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(12, 28, w - 24, h - 38);
    const nodes: Array<[number, number]> = [
      [w * 0.28, h * 0.46],
      [w * 0.54, h * 0.36],
      [w * 0.54, h * 0.68],
      [w * 0.78, h * 0.52],
    ];
    ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(nodes[0]![0], nodes[0]![1]);
    ctx.lineTo(nodes[1]![0], nodes[1]![1]);
    ctx.lineTo(nodes[3]![0], nodes[3]![1]);
    ctx.moveTo(nodes[0]![0], nodes[0]![1]);
    ctx.lineTo(nodes[2]![0], nodes[2]![1]);
    ctx.lineTo(nodes[3]![0], nodes[3]![1]);
    ctx.stroke();
    nodes.forEach(([nx, ny], idx) => {
      const pulse = 10 + Math.sin(tick * 3.2 + idx) * 2.5;
      ctx.fillStyle = idx === Math.floor(tick * 1.5) % nodes.length ? "#fbbf24" : accentHex;
      ctx.beginPath();
      ctx.arc(nx, ny, pulse, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }

  if (workAction === "coding" || workAction === "replying" || workAction === "screen" || screenState === "working") {
    ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
    ctx.fillRect(14, 30, 52, h - 42);
    const widths = [0.58, 0.42, 0.68, 0.35, 0.52, 0.61, 0.46];
    const scroll = Math.floor(tick * 2.8);
    for (let row = 0; row < 6; row++) {
      const y = 36 + row * 17;
      const lineRatio = widths[(row + scroll) % widths.length]!;
      ctx.fillStyle = row % 3 === 0 ? accentHex : row % 2 === 0 ? "#38bdf8" : "rgba(226, 232, 240, 0.65)";
      ctx.fillRect(78, y, (w - 98) * lineRatio, 8);
    }
    if (Math.floor(tick * 3.8) % 2 === 0) {
      ctx.fillStyle = "#10b981";
      ctx.fillRect(78, 36 + 5 * 17, 10, 9);
    }
    return;
  }

  const gradient = ctx.createLinearGradient(0, 22, w, h);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#1e293b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 22, w, h - 22);
  ctx.fillStyle = accentHex;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 + 8, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawImageCover(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.fillStyle = "#0b0f17";
  ctx.fillRect(0, 0, cw, ch);
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const scale = Math.min(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawKpiWallBoard(canvas: HTMLCanvasElement, kpi: OfficeKpiSummary) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#060d1b");
  bg.addColorStop(0.55, "#0b172a");
  bg.addColorStop(1, "#091224");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(56, 189, 248, 0.16)";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  const statusHex = kpi.health === "critical" ? "#ef4444" : kpi.health === "attention" ? "#f59e0b" : "#10b981";
  const statusText = kpi.health === "critical"
    ? t("office3d.kpi.status.critical", { count: kpi.alertCount })
    : kpi.health === "attention"
      ? t("office3d.kpi.status.attention", { count: kpi.alertCount })
      : t("office3d.kpi.status.healthy");

  ctx.fillStyle = statusHex;
  ctx.beginPath();
  ctx.arc(40, 44, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "700 26px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.textBaseline = "middle";
  ctx.fillText(t("office3d.kpi.wallTitle"), 62, 44);

  ctx.font = "600 18px system-ui, -apple-system, sans-serif";
  const badgeW = Math.min(320, ctx.measureText(statusText).width + 36);
  drawRoundedRect(ctx, w - badgeW - 28, 24, badgeW, 38, 19);
  ctx.fillStyle = kpi.health === "critical"
    ? "rgba(239, 68, 68, 0.22)"
    : kpi.health === "attention"
      ? "rgba(245, 158, 11, 0.22)"
      : "rgba(16, 185, 129, 0.2)";
  ctx.fill();
  ctx.strokeStyle = statusHex;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = statusHex;
  ctx.fillText(statusText, w - badgeW - 10, 43);

  const cards = [
    {
      label: t("office3d.kpi.workforce"),
      value: `${kpi.utilizationPct}%`,
      sub: t("office3d.kpi.workforceSub", { active: kpi.activeBots, total: kpi.totalBots, ready: kpi.readyBots }),
      accent: "#10b981",
      barRatio: kpi.utilizationPct / 100,
    },
    {
      label: t("office3d.kpi.throughput"),
      value: t("office3d.kpi.throughputValue", { turns: formatCompactNumber(kpi.totalTurns) }),
      sub: t("office3d.kpi.throughputSub", { done: kpi.completedThreads, open: kpi.openThreads }),
      accent: "#38bdf8",
      barRatio: kpi.completedThreads + kpi.openThreads > 0
        ? kpi.completedThreads / (kpi.completedThreads + kpi.openThreads)
        : 0,
    },
    {
      label: t("office3d.kpi.routines"),
      value: kpi.routineSuccessPct !== null
        ? `${kpi.routineSuccessPct}%`
        : kpi.enabledRoutines > 0
          ? `${kpi.enabledRoutines}`
          : "—",
      sub: kpi.totalRoutines > 0
        ? t("office3d.kpi.routinesSub", {
          enabled: kpi.enabledRoutines,
          ok: kpi.weekRunsOk,
          total: kpi.weekRunsTotal,
        })
        : t("office3d.kpi.routinesNone"),
      accent: kpi.problemRoutineRuns > 0 ? "#ef4444" : "#a855f7",
      barRatio: kpi.routineSuccessPct !== null ? kpi.routineSuccessPct / 100 : (kpi.enabledRoutines > 0 ? 0.5 : 0),
    },
    {
      label: t("office3d.kpi.tokens"),
      value: formatCompactNumber(kpi.totalTokens),
      sub: t("office3d.kpi.tokensSub", {
        cache: kpi.cacheHitPct,
        cost: kpi.hasReportedCost ? formatUsdAmount(kpi.totalCostUsd) : t("office3d.kpi.costUnreported"),
      }),
      accent: kpi.budgetUsedPct !== null && kpi.budgetUsedPct >= kpi.budgetWarnPct ? "#f59e0b" : "#22d3ee",
      barRatio: kpi.budgetUsedPct !== null ? Math.min(1, kpi.budgetUsedPct / 100) : kpi.cacheHitPct / 100,
    },
  ];

  const padX = 28;
  const gap = 18;
  const cardW = (w - padX * 2 - gap * 3) / 4;
  const cardY = 82;
  const cardH = 178;

  cards.forEach((card, idx) => {
    const cx = padX + idx * (cardW + gap);
    drawRoundedRect(ctx, cx, cardY, cardW, cardH, 16);
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = card.accent;
    ctx.fillRect(cx + 16, cardY + 18, 28, 5);

    ctx.font = "600 17px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(card.label, cx + 16, cardY + 46, cardW - 32);

    ctx.font = "800 42px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(card.value, cx + 16, cardY + 96, cardW - 32);

    ctx.font = "500 15px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(card.sub, cx + 16, cardY + 134, cardW - 32);

    drawRoundedRect(ctx, cx + 16, cardY + 154, cardW - 32, 8, 4);
    ctx.fillStyle = "rgba(51, 65, 85, 0.85)";
    ctx.fill();
    const fillW = Math.max(0, Math.min(1, card.barRatio)) * (cardW - 32);
    if (fillW > 2) {
      drawRoundedRect(ctx, cx + 16, cardY + 154, fillW, 8, 4);
      ctx.fillStyle = card.accent;
      ctx.fill();
    }
  });

  const deptY = 282;
  const deptH = h - deptY - 24;
  drawRoundedRect(ctx, padX, deptY, w - padX * 2, deptH, 16);
  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = "700 17px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(t("office3d.kpi.departmentsTitle"), padX + 18, deptY + 26);

  const visibleDepts = kpi.departments.slice(0, 4);
  if (visibleDepts.length > 0) {
    const colGap = 18;
    const colW = (w - padX * 2 - 36 - colGap * Math.max(0, visibleDepts.length - 1)) / visibleDepts.length;
    const maxTokens = Math.max(1, ...visibleDepts.map((d) => d.totalTokens));

    visibleDepts.forEach((dept, idx) => {
      const dx = padX + 18 + idx * (colW + colGap);
      const dy = deptY + 52;
      ctx.fillStyle = dept.accentHex;
      ctx.beginPath();
      ctx.arc(dx + 7, dy + 2, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 17px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(dept.name, dx + 20, dy + 2, colW - 24);

      ctx.font = "500 14px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(
        t("office3d.kpi.deptStats", {
          active: dept.activeBots,
          total: dept.totalBots,
          turns: dept.turns,
          tokens: formatCompactNumber(dept.totalTokens),
        }),
        dx,
        dy + 28,
        colW,
      );

      drawRoundedRect(ctx, dx, dy + 48, colW, 10, 5);
      ctx.fillStyle = "rgba(51, 65, 85, 0.85)";
      ctx.fill();
      const ratio = dept.totalTokens > 0
        ? Math.max(0.12, dept.totalTokens / maxTokens)
        : dept.activityPct / 100;
      const barW = Math.max(0, Math.min(1, ratio)) * colW;
      if (barW > 2) {
        drawRoundedRect(ctx, dx, dy + 48, barW, 10, 5);
        ctx.fillStyle = dept.accentHex;
        ctx.fill();
      }
    });
  }
}

export function buildKpiWallGroup(
  centerX: number,
  frontZ: number,
  boardWidth: number,
  kpi: OfficeKpiSummary,
): { group: THREE.Group; rig: KpiWallRig } {
  const group = new THREE.Group();
  group.position.set(centerX, 0, frontZ);
  group.userData.kpiWall = true;

  const boardHeight = 2.05;
  const centerY = 1.66;

  const stanchionMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.55 });
  for (const sx of [-boardWidth * 0.36, boardWidth * 0.36]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, centerY + boardHeight * 0.42, 0.11), stanchionMat);
    post.position.set(sx, (centerY + boardHeight * 0.42) / 2, -0.04);
    post.castShadow = true;
    group.add(post);
  }

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(boardWidth + 0.18, boardHeight + 0.18, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.36, metalness: 0.48 }),
  );
  frame.position.set(0, centerY, 0.02);
  frame.castShadow = true;
  frame.receiveShadow = true;
  frame.userData.kpiWall = true;
  group.add(frame);

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 432;
  drawKpiWallBoard(canvas, kpi);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(boardWidth, boardHeight),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  screen.position.set(0, centerY, 0.076);
  screen.userData.kpiWall = true;
  group.add(screen);

  const beaconMat = new THREE.MeshBasicMaterial({
    color: kpi.health === "critical" ? 0xef4444 : kpi.health === "attention" ? 0xf59e0b : 0x10b981,
  });
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(boardWidth * 0.72, 0.055, 0.06),
    beaconMat,
  );
  beacon.position.set(0, centerY + boardHeight / 2 + 0.09, 0.045);
  group.add(beacon);

  return {
    group,
    rig: { canvas, texture, beaconMat },
  };
}
