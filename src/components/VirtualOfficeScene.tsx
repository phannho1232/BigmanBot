import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  OFFICE_BOT_DRAG_MIME,
  VirtualOfficeFallback,
  VirtualOfficeOverlayHud,
  type DragDropTarget,
  type DragHudState,
} from "./VirtualOfficeSceneHud";
import { t } from "@/lib/i18n";
import {
  deskFocusCamera,
  kpiWallCamera,
  meetingTableCamera,
  type OfficeBotInput,
  type OfficeCameraPose,
  type OfficePlan,
} from "@/lib/virtual-office";
import {
  drawKpiWallBoard,
  type KpiWallRig,
} from "@/lib/virtual-office-canvas";
import {
  createDragVisualController,
  resolveOfficeDropAt,
  resolveOfficeSceneHit,
  type SceneHit,
} from "@/lib/virtual-office-drag";
import type { OfficeKpiSummary } from "@/lib/virtual-office-kpi";
import {
  detectDocumentDark,
  stepOfficeRigsAndConnections,
  syncControlsPose,
} from "@/lib/virtual-office-locomotion";
import {
  disposeSceneResources,
  populateOfficeWorldGroup,
  rebuildDynamicConnectionsGroup,
  type AnimatedBotRig,
  type AnimatedConversationRing,
  type AnimatedHandoffPacket,
} from "@/lib/virtual-office-rigs";

export { OFFICE_BOT_DRAG_MIME };
export type OfficeLightingMode = "auto" | "day" | "night";

export interface VirtualOfficeSceneProps<T extends OfficeBotInput> {
  plan: OfficePlan<T>;
  kpi: OfficeKpiSummary;
  botDisplayNames: Readonly<Record<string, string>>;
  selectedBotId: string | null;
  lightingMode: OfficeLightingMode;
  resetNonce: number;
  kpiFocusNonce: number;
  meetingFocusNonce?: number;
  roundtableAttendeeCount?: number;
  focusRequest: { botId: string; nonce: number } | null;
  canManage?: boolean;
  onSelectBot: (botId: string | null) => void;
  onOpenBotChat: (bot: T) => void;
  onPairBots?: (sourceBotId: string, targetBotId: string) => void;
  onMoveBotToSection?: (botId: string, targetSectionKey: string, targetSectionName: string) => void;
  onSelectMeetingTable?: () => void;
  onDropBotOnMeetingTable?: (botId: string) => void;
  onSelectKpiWall?: () => void;
}

export function VirtualOfficeScene<T extends OfficeBotInput>({
  plan,
  kpi,
  botDisplayNames,
  selectedBotId,
  lightingMode,
  resetNonce,
  kpiFocusNonce,
  meetingFocusNonce = 0,
  roundtableAttendeeCount = 0,
  focusRequest,
  canManage = false,
  onSelectBot,
  onOpenBotChat,
  onPairBots,
  onMoveBotToSection,
  onSelectMeetingTable,
  onDropBotOnMeetingTable,
  onSelectKpiWall,
}: VirtualOfficeSceneProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const overlayRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const zoneLabelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const meetingBadgeRef = useRef<HTMLButtonElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [systemDark, setSystemDark] = useState(detectDocumentDark);
  const [dragHud, setDragHud] = useState<DragHudState | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const worldGroupRef = useRef<THREE.Group | null>(null);
  const dynamicGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rigsRef = useRef<AnimatedBotRig[]>([]);
  const kpiWallRef = useRef<KpiWallRig | null>(null);
  const packetsRef = useRef<AnimatedHandoffPacket[]>([]);
  const convRingsRef = useRef<AnimatedConversationRing[]>([]);
  const pickablesRef = useRef<THREE.Object3D[]>([]);
  const zoneRugsRef = useRef<THREE.Object3D[]>([]);
  const cameraGoalRef = useRef<OfficeCameraPose | null>(null);
  const prevLayoutWasEmptyRef = useRef(plan.desks.length === 0);
  const lastKpiSignatureRef = useRef("");
  const appliedResetNonceRef = useRef(0);
  const appliedKpiFocusNonceRef = useRef(0);
  const appliedMeetingFocusNonceRef = useRef(0);
  const appliedFocusNonceRef = useRef(0);
  const externalDropHandlerRef = useRef<{
    preview: (sourceBotId: string, clientX: number, clientY: number) => void;
    commit: (sourceBotId: string, clientX: number, clientY: number) => void;
    clear: () => void;
  } | null>(null);

  const selectedIdRef = useRef(selectedBotId);
  selectedIdRef.current = selectedBotId;
  const planRef = useRef(plan);
  planRef.current = plan;
  const kpiRef = useRef(kpi);
  kpiRef.current = kpi;
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;
  const onSelectBotRef = useRef(onSelectBot);
  onSelectBotRef.current = onSelectBot;
  const onOpenBotChatRef = useRef(onOpenBotChat);
  onOpenBotChatRef.current = onOpenBotChat;
  const onPairBotsRef = useRef(onPairBots);
  onPairBotsRef.current = onPairBots;
  const onMoveBotToSectionRef = useRef(onMoveBotToSection);
  onMoveBotToSectionRef.current = onMoveBotToSection;
  const onSelectMeetingTableRef = useRef(onSelectMeetingTable);
  onSelectMeetingTableRef.current = onSelectMeetingTable;
  const onDropBotOnMeetingTableRef = useRef(onDropBotOnMeetingTable);
  onDropBotOnMeetingTableRef.current = onDropBotOnMeetingTable;
  const onSelectKpiWallRef = useRef(onSelectKpiWall);
  onSelectKpiWallRef.current = onSelectKpiWall;

  useEffect(() => {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const sync = () => setSystemDark(detectDocumentDark());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-skin", "data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  const isNight = lightingMode === "night" || (lightingMode === "auto" && systemDark);

  const stepCameraOrbit = useCallback((deltaAzimuth: number, deltaPolar: number, zoomFactor = 1) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const base = cameraGoalRef.current ?? {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    };
    const offset = new THREE.Vector3(
      base.position.x - base.target.x,
      base.position.y - base.target.y,
      base.position.z - base.target.z,
    );
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaAzimuth;
    spherical.phi = Math.max(
      controls.minPolarAngle + 0.03,
      Math.min(controls.maxPolarAngle - 0.02, spherical.phi + deltaPolar),
    );
    spherical.radius = Math.max(
      controls.minDistance,
      Math.min(controls.maxDistance, spherical.radius * zoomFactor),
    );
    offset.setFromSpherical(spherical);
    cameraGoalRef.current = {
      target: { ...base.target },
      position: {
        x: base.target.x + offset.x,
        y: base.target.y + offset.y,
        z: base.target.z + offset.z,
      },
    };
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    const container = containerRef.current;
    if (!host || !container) return;

    const denseInitial = planRef.current.desks.length > 16;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !denseInitial,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
      } catch {
        setWebglFailed(true);
        return;
      }
    }

    renderer.setPixelRatio(denseInitial ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.shadowMap.enabled = !denseInitial;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);
    worldGroupRef.current = worldGroup;

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);
    dynamicGroupRef.current = dynamicGroup;

    const dragVisuals = createDragVisualController();
    scene.add(dragVisuals.group);

    const initialBounds = container.getBoundingClientRect();
    const width = Math.max(1, initialBounds.width);
    const height = Math.max(1, initialBounds.height);
    renderer.setSize(width, height, false);

    const initialSpan = Math.max(planRef.current.floor.width, planRef.current.floor.depth);
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.4, Math.max(240, initialSpan * 5));
    const initialPose = planRef.current.overviewCamera;
    camera.position.set(initialPose.position.x, initialPose.position.y, initialPose.position.z);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, container);
    controls.target.set(initialPose.target.x, initialPose.target.y, initialPose.target.z);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.rotateSpeed = 0.82;
    controls.zoomSpeed = 0.88;
    controls.panSpeed = 0.88;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minPolarAngle = 0.12;
    controls.minDistance = 2.6;
    controls.maxDistance = Math.max(90, initialSpan * 2.4);
    controls.screenSpacePanning = false;
    controls.update();
    controlsRef.current = controls;

    const cancelGoal = () => {
      if (cameraGoalRef.current) {
        cameraGoalRef.current = null;
        syncControlsPose(controls, camera);
      }
    };
    controls.addEventListener("start", cancelGoal);
    container.addEventListener("wheel", cancelGoal, { passive: true });
    container.addEventListener("pointerdown", cancelGoal);
    container.addEventListener("touchstart", cancelGoal, { passive: true });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.04);
    const floorHitVec = new THREE.Vector3();

    let pointerDownAt: { x: number; y: number } | null = null;
    let activeDrag: {
      sourceBotId: string;
      pointerId: number;
      startX: number;
      startY: number;
      lastClientX: number;
      lastClientY: number;
      movedBeyondThreshold: boolean;
      floorX: number;
      floorZ: number;
      target: DragDropTarget;
    } | null = null;

    const setRayFromClient = (clientX: number, clientY: number): boolean => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return true;
    };

    const resolveSceneHit = (clientX: number, clientY: number): SceneHit =>
      setRayFromClient(clientX, clientY) ? resolveOfficeSceneHit(raycaster, pickablesRef.current) : null;

    const resolveDropAt = (sourceBotId: string, clientX: number, clientY: number) =>
      resolveOfficeDropAt({
        sourceBotId,
        clientX,
        clientY,
        rayReady: setRayFromClient(clientX, clientY),
        raycaster,
        floorPlane,
        floorHitVec,
        plan: planRef.current,
        canManage: canManageRef.current,
        rigs: rigsRef.current,
        pickables: pickablesRef.current,
        zoneRugs: zoneRugsRef.current,
        overlayMap: overlayRefs.current,
        zoneLabelMap: zoneLabelRefs.current,
        meetingBadgeEl: meetingBadgeRef.current,
      });

    const clearDragVisuals = () => {
      dragVisuals.clear();
      setDragHud(null);
    };

    const updateHudFromClient = (sourceBotId: string, clientX: number, clientY: number, target: DragDropTarget) => {
      const rect = container.getBoundingClientRect();
      setDragHud({
        sourceBotId,
        x: Math.max(16, Math.min(rect.width - 16, clientX - rect.left)),
        y: Math.max(24, Math.min(rect.height - 16, clientY - rect.top)),
        target,
      });
    };

    const commitDropResult = (sourceBotId: string, target: DragDropTarget) => {
      if (target?.kind === "pair") {
        onPairBotsRef.current?.(sourceBotId, target.targetBotId);
      } else if (target?.kind === "meeting-table") {
        onDropBotOnMeetingTableRef.current?.(sourceBotId);
      } else if (target?.kind === "move-zone") {
        onMoveBotToSectionRef.current?.(sourceBotId, target.zoneKey, target.zoneName);
      }
    };

    externalDropHandlerRef.current = {
      preview: (sourceBotId, clientX, clientY) => {
        const resolved = resolveDropAt(sourceBotId, clientX, clientY);
        dragVisuals.sync(
          sourceBotId,
          resolved.target,
          resolved.floorX,
          resolved.floorZ,
          performance.now() * 0.001,
          rigsRef.current,
          planRef.current,
        );
        updateHudFromClient(sourceBotId, clientX, clientY, resolved.target);
      },
      commit: (sourceBotId, clientX, clientY) => {
        const resolved = resolveDropAt(sourceBotId, clientX, clientY);
        clearDragVisuals();
        commitDropResult(sourceBotId, resolved.target);
      },
      clear: clearDragVisuals,
    };

    const finishActiveDrag = (commitDrop: boolean, clientX: number, clientY: number) => {
      if (!activeDrag) return;
      const session = activeDrag;
      activeDrag = null;
      pointerDownAt = null;
      clearDragVisuals();
      controls.enabled = true;
      syncControlsPose(controls, camera);
      container.style.cursor = "grab";

      if (!session.movedBeyondThreshold) {
        if (commitDrop) {
          onSelectBotRef.current(selectedIdRef.current === session.sourceBotId ? null : session.sourceBotId);
        }
        return;
      }

      if (!commitDrop) return;
      const resolved = resolveDropAt(session.sourceBotId, clientX, clientY);
      commitDropResult(session.sourceBotId, resolved.target);
    };

    const onPointerDownCapture = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest("[data-office-camera-controls]")) {
        pointerDownAt = null;
        return;
      }
      if (activeDrag) {
        finishActiveDrag(false, event.clientX, event.clientY);
      }
      if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const domHandle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-office-drag-bot]");
      const domBotId = domHandle?.dataset.officeDragBot;
      const hit = domBotId ? { kind: "bot" as const, botId: domBotId, draggable: true } : resolveSceneHit(event.clientX, event.clientY);

      if (hit?.kind === "bot" && hit.draggable) {
        cancelGoal();
        controls.enabled = false;
        activeDrag = {
          sourceBotId: hit.botId,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          movedBeyondThreshold: false,
          floorX: 0,
          floorZ: 0,
          target: null,
        };
        pointerDownAt = null;
        container.style.cursor = "grabbing";
        return;
      }

      pointerDownAt = { x: event.clientX, y: event.clientY };
    };

    const onWindowPointerMove = (event: PointerEvent) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      activeDrag.lastClientX = event.clientX;
      activeDrag.lastClientY = event.clientY;
      const moved = Math.hypot(event.clientX - activeDrag.startX, event.clientY - activeDrag.startY);
      if (!activeDrag.movedBeyondThreshold && moved <= 6) return;
      activeDrag.movedBeyondThreshold = true;
      container.style.cursor = "grabbing";

      const resolved = resolveDropAt(activeDrag.sourceBotId, event.clientX, event.clientY);
      activeDrag.floorX = resolved.floorX;
      activeDrag.floorZ = resolved.floorZ;
      activeDrag.target = resolved.target;
      dragVisuals.sync(
        activeDrag.sourceBotId,
        resolved.target,
        resolved.floorX,
        resolved.floorZ,
        performance.now() * 0.001,
        rigsRef.current,
        planRef.current,
      );
      updateHudFromClient(activeDrag.sourceBotId, event.clientX, event.clientY, resolved.target);
    };

    const onWindowPointerUp = (event: PointerEvent) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      finishActiveDrag(true, event.clientX, event.clientY);
    };

    const onWindowPointerCancel = (event: PointerEvent) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      finishActiveDrag(false, event.clientX, event.clientY);
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeDrag) {
        finishActiveDrag(false, activeDrag.lastClientX, activeDrag.lastClientY);
      }
    };

    const onWindowBlur = () => {
      if (activeDrag) {
        finishActiveDrag(false, activeDrag.lastClientX, activeDrag.lastClientY);
      }
      controls.enabled = true;
    };

    let lastHoverCheck = 0;
    const onPointerMove = (event: PointerEvent) => {
      if (activeDrag || event.buttons !== 0) return;
      const nowMs = performance.now();
      if (nowMs - lastHoverCheck < 80) return;
      lastHoverCheck = nowMs;
      const hovered = resolveSceneHit(event.clientX, event.clientY);
      const nextCursor = hovered?.kind === "bot" && hovered.draggable
        ? "grab"
        : hovered
          ? "pointer"
          : "default";
      if (container.style.cursor !== nextCursor) {
        container.style.cursor = nextCursor;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (activeDrag || !pointerDownAt || event.button !== 0) return;
      const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
      pointerDownAt = null;
      if (moved > 6) return;
      if ((event.target as HTMLElement | null)?.closest("[data-office-meeting-badge]")) return;
      const hit = resolveSceneHit(event.clientX, event.clientY);
      if (hit?.kind === "kpi-wall") {
        onSelectKpiWallRef.current?.();
        return;
      }
      if (hit?.kind === "meeting-table") {
        cameraGoalRef.current = meetingTableCamera(planRef.current.meetingTable);
        onSelectMeetingTableRef.current?.();
        return;
      }
      onSelectBotRef.current(hit?.kind === "bot" ? hit.botId : null);
    };

    const onDoubleClick = (event: MouseEvent) => {
      const domHandle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-office-drag-bot]");
      const domBotId = domHandle?.dataset.officeDragBot;
      if (domBotId) {
        const desk = planRef.current.desks.find((item) => item.bot.id === domBotId);
        if (desk) onOpenBotChatRef.current(desk.bot);
        return;
      }
      if ((event.target as HTMLElement | null)?.closest("[data-office-meeting-badge]")) {
        cameraGoalRef.current = meetingTableCamera(planRef.current.meetingTable);
        onSelectMeetingTableRef.current?.();
        return;
      }
      const hit = resolveSceneHit(event.clientX, event.clientY);
      if (!hit) return;
      if (hit.kind === "kpi-wall") {
        cameraGoalRef.current = kpiWallCamera(planRef.current.floor);
        onSelectKpiWallRef.current?.();
        return;
      }
      if (hit.kind === "meeting-table") {
        cameraGoalRef.current = meetingTableCamera(planRef.current.meetingTable);
        onSelectMeetingTableRef.current?.();
        return;
      }
      const desk = planRef.current.desks.find((item) => item.bot.id === hit.botId);
      if (desk) onOpenBotChatRef.current(desk.bot);
    };

    container.addEventListener("pointerdown", onPointerDownCapture, { capture: true });
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("blur", onWindowBlur);

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    });
    resizeObserver.observe(container);

    const projected = new THREE.Vector3();
    const goalPositionVec = new THREE.Vector3();
    const goalTargetVec = new THREE.Vector3();
    const pinCache = new WeakMap<HTMLElement, { x: number; y: number; visible: boolean }>();
    const syncPinPosition = (el: HTMLElement, visible: boolean, px: number, py: number, suffix: string) => {
      const prev = pinCache.get(el);
      if (!visible) {
        if (!prev || prev.visible) {
          el.style.opacity = "0";
          el.style.visibility = "hidden";
          pinCache.set(el, { x: -9999, y: -9999, visible: false });
        }
        return;
      }
      if (prev && prev.visible && Math.abs(prev.x - px) < 0.4 && Math.abs(prev.y - py) < 0.4) {
        return;
      }
      el.style.visibility = "visible";
      el.style.opacity = "1";
      el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) ${suffix}`;
      pinCache.set(el, { x: px, y: py, visible: true });
    };

    let rafId = 0;
    let lastScreenRedraw = 0;
    const startClock = performance.now();
    let prevNow = startClock;

    const animate = (now: number) => {
      rafId = window.requestAnimationFrame(animate);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        prevNow = now;
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - prevNow) * 0.001));
      prevNow = now;
      const elapsed = (now - startClock) * 0.001;

      const goal = cameraGoalRef.current;
      if (goal) {
        const blend = 1 - Math.exp(-dt * 8.5);
        goalPositionVec.set(goal.position.x, goal.position.y, goal.position.z);
        goalTargetVec.set(goal.target.x, goal.target.y, goal.target.z);
        camera.position.lerp(goalPositionVec, blend);
        controls.target.lerp(goalTargetVec, blend);
        camera.lookAt(controls.target);
        const posDist = camera.position.distanceTo(goalPositionVec);
        const targetDist = controls.target.distanceTo(goalTargetVec);
        if (posDist < 0.04 && targetDist < 0.04) {
          camera.position.copy(goalPositionVec);
          controls.target.copy(goalTargetVec);
          cameraGoalRef.current = null;
          syncControlsPose(controls, camera);
        }
      } else {
        controls.update(dt);
      }

      const redrawScreens = now - lastScreenRedraw > 650;
      if (redrawScreens) lastScreenRedraw = now;

      const currentPlan = planRef.current;
      stepOfficeRigsAndConnections({
        rigs: rigsRef.current,
        packets: packetsRef.current,
        convRings: convRingsRef.current,
        plan: currentPlan,
        selectedBotId: selectedIdRef.current,
        dt,
        elapsed,
        redrawScreens,
      });

      if (activeDrag && activeDrag.movedBeyondThreshold) {
        dragVisuals.sync(
          activeDrag.sourceBotId,
          activeDrag.target,
          activeDrag.floorX,
          activeDrag.floorZ,
          elapsed,
          rigsRef.current,
          currentPlan,
        );
      }

      const canvasW = renderer.domElement.clientWidth;
      const canvasH = renderer.domElement.clientHeight;
      if (canvasW > 0 && canvasH > 0) {
        if (overlayRefs.current.size > 0) {
          for (const rig of rigsRef.current) {
            const el = overlayRefs.current.get(rig.botId);
            if (!el) continue;
            projected.set(rig.currentX, rig.currentY + 1.18, rig.currentZ).project(camera);
            if (projected.z > 1 || projected.z < -1) {
              syncPinPosition(el, false, 0, 0, "translate(-50%, -100%)");
              continue;
            }
            syncPinPosition(
              el,
              true,
              (projected.x * 0.5 + 0.5) * canvasW,
              (-projected.y * 0.5 + 0.5) * canvasH,
              "translate(-50%, -100%)",
            );
          }
        }

        for (const zone of currentPlan.zones) {
          const el = zoneLabelRefs.current.get(zone.key || "__general__");
          if (!el) continue;
          projected.set(zone.x - zone.width / 2 + 0.45, 0.18, zone.z + zone.depth / 2 - 0.25).project(camera);
          if (projected.z > 1 || projected.z < -1) {
            syncPinPosition(el, false, 0, 0, "translate(0, -50%)");
            continue;
          }
          syncPinPosition(
            el,
            true,
            (projected.x * 0.5 + 0.5) * canvasW,
            (-projected.y * 0.5 + 0.5) * canvasH,
            "translate(0, -50%)",
          );
        }

        const meetingEl = meetingBadgeRef.current;
        if (meetingEl) {
          projected.set(currentPlan.meetingTable.x, 1.02, currentPlan.meetingTable.z).project(camera);
          if (projected.z > 1 || projected.z < -1) {
            syncPinPosition(meetingEl, false, 0, 0, "translate(-50%, -100%)");
          } else {
            syncPinPosition(
              meetingEl,
              true,
              (projected.x * 0.5 + 0.5) * canvasW,
              (-projected.y * 0.5 + 0.5) * canvasH,
              "translate(-50%, -100%)",
            );
          }
        }
      }

      renderer.render(scene, camera);
    };
    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.removeEventListener("start", cancelGoal);
      container.removeEventListener("wheel", cancelGoal);
      container.removeEventListener("pointerdown", cancelGoal);
      container.removeEventListener("touchstart", cancelGoal);
      controls.dispose();
      container.removeEventListener("pointerdown", onPointerDownCapture, { capture: true });
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerCancel);
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("blur", onWindowBlur);
      externalDropHandlerRef.current = null;
      disposeSceneResources(scene);
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      worldGroupRef.current = null;
      dynamicGroupRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rigsRef.current = [];
      kpiWallRef.current = null;
      packetsRef.current = [];
      convRingsRef.current = [];
      pickablesRef.current = [];
      zoneRugsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (resetNonce === 0 || resetNonce === appliedResetNonceRef.current) return;
    appliedResetNonceRef.current = resetNonce;
    cameraGoalRef.current = planRef.current.overviewCamera;
  }, [resetNonce]);

  useEffect(() => {
    if (kpiFocusNonce === 0 || kpiFocusNonce === appliedKpiFocusNonceRef.current) return;
    appliedKpiFocusNonceRef.current = kpiFocusNonce;
    cameraGoalRef.current = kpiWallCamera(planRef.current.floor);
  }, [kpiFocusNonce]);

  useEffect(() => {
    if (meetingFocusNonce === 0 || meetingFocusNonce === appliedMeetingFocusNonceRef.current) return;
    appliedMeetingFocusNonceRef.current = meetingFocusNonce;
    cameraGoalRef.current = meetingTableCamera(planRef.current.meetingTable);
  }, [meetingFocusNonce]);

  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === appliedFocusNonceRef.current) return;
    appliedFocusNonceRef.current = focusRequest.nonce;
    const rig = rigsRef.current.find((item) => item.botId === focusRequest.botId);
    if (rig && rig.mode !== "seated") {
      const viewAngle = rig.currentRotY + 0.52;
      cameraGoalRef.current = {
        target: { x: rig.currentX, y: 0.95, z: rig.currentZ },
        position: {
          x: rig.currentX + Math.sin(viewAngle) * 4.5,
          y: 3.25,
          z: rig.currentZ + Math.cos(viewAngle) * 4.5,
        },
      };
      return;
    }
    const desk = planRef.current.desks.find((item) => item.bot.id === focusRequest.botId);
    if (desk) cameraGoalRef.current = deskFocusCamera(desk);
  }, [focusRequest]);

  useEffect(() => {
    const scene = sceneRef.current;
    const worldGroup = worldGroupRef.current;
    if (!scene || !worldGroup) return;

    const currentPlan = planRef.current;
    const dense = currentPlan.desks.length > 16;
    if (rendererRef.current) {
      rendererRef.current.shadowMap.enabled = !dense;
      rendererRef.current.setPixelRatio(dense ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    }
    const maxSpan = Math.max(currentPlan.floor.width, currentPlan.floor.depth);
    if (cameraRef.current) {
      cameraRef.current.far = Math.max(240, maxSpan * 5);
      cameraRef.current.updateProjectionMatrix();
    }
    if (controlsRef.current) {
      controlsRef.current.maxDistance = Math.max(90, maxSpan * 2.4);
    }

    if (currentPlan.desks.length === 0) {
      prevLayoutWasEmptyRef.current = true;
    } else if (prevLayoutWasEmptyRef.current) {
      prevLayoutWasEmptyRef.current = false;
      cameraGoalRef.current = currentPlan.overviewCamera;
    }

    disposeSceneResources(worldGroup);
    worldGroup.clear();
    const built = populateOfficeWorldGroup({
      scene,
      worldGroup,
      plan: currentPlan,
      kpi: kpiRef.current,
      isNight,
      selectedBotId: selectedIdRef.current,
    });
    rigsRef.current = built.rigs;
    pickablesRef.current = built.pickables;
    zoneRugsRef.current = built.zoneRugs;
    kpiWallRef.current = built.kpiWall;
    lastKpiSignatureRef.current = "";
  }, [plan.layoutKey, isNight]);

  useEffect(() => {
    const kpiRig = kpiWallRef.current;
    if (!kpiRig) return;
    const signature = `${kpi.health}:${kpi.alertCount}:${kpi.utilizationPct}:${kpi.activeBots}:${kpi.totalBots}:${kpi.totalTurns}:${kpi.completedThreads}:${kpi.openThreads}:${kpi.routineSuccessPct}:${kpi.totalTokens}:${kpi.totalCostUsd}`;
    if (lastKpiSignatureRef.current === signature) return;
    lastKpiSignatureRef.current = signature;
    drawKpiWallBoard(kpiRig.canvas, kpi);
    kpiRig.texture.needsUpdate = true;
    kpiRig.beaconMat.color.setHex(
      kpi.health === "critical" ? 0xef4444 : kpi.health === "attention" ? 0xf59e0b : 0x10b981,
    );
  }, [kpi]);

  useEffect(() => {
    const deskByBotId = new Map(plan.desks.map((item) => [item.bot.id, item]));
    for (const rig of rigsRef.current) {
      const desk = deskByBotId.get(rig.botId);
      if (desk) rig.stepOutPoint = desk.stepOutPoint;
    }

    if (dynamicGroupRef.current) {
      const rebuilt = rebuildDynamicConnectionsGroup(dynamicGroupRef.current, plan);
      packetsRef.current = rebuilt.packets;
      convRingsRef.current = rebuilt.convRings;
    }
  }, [plan]);

  if (webglFailed) {
    return (
      <VirtualOfficeFallback
        plan={plan}
        botDisplayNames={botDisplayNames}
        roundtableAttendeeCount={roundtableAttendeeCount}
        canManage={canManage}
        onSelectMeetingTable={onSelectMeetingTable}
        onDropBotOnMeetingTable={onDropBotOnMeetingTable}
        onMoveBotToSection={onMoveBotToSection}
        onPairBots={onPairBots}
        onOpenBotChat={onOpenBotChat}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={t("office3d.region")}
      data-virtual-office-canvas
      onDragOver={(event) => {
        const sourceId = event.dataTransfer.getData(OFFICE_BOT_DRAG_MIME) || event.dataTransfer.getData("text/plain");
        if (!sourceId || !plan.desks.some((item) => item.bot.id === sourceId)) return;
        event.preventDefault();
        externalDropHandlerRef.current?.preview(sourceId, event.clientX, event.clientY);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          externalDropHandlerRef.current?.clear();
        }
      }}
      onDrop={(event) => {
        const sourceId = event.dataTransfer.getData(OFFICE_BOT_DRAG_MIME) || event.dataTransfer.getData("text/plain");
        if (!sourceId || !plan.desks.some((item) => item.bot.id === sourceId)) return;
        event.preventDefault();
        externalDropHandlerRef.current?.commit(sourceId, event.clientX, event.clientY);
      }}
      className="relative min-h-0 flex-1 overflow-hidden select-none touch-none"
    >
      <div ref={canvasHostRef} className="absolute inset-0" />

      <VirtualOfficeOverlayHud
        plan={plan}
        botDisplayNames={botDisplayNames}
        selectedBotId={selectedBotId}
        roundtableAttendeeCount={roundtableAttendeeCount}
        canManage={canManage}
        dragHud={dragHud}
        overlayRefs={overlayRefs}
        zoneLabelRefs={zoneLabelRefs}
        meetingBadgeRef={meetingBadgeRef}
        onSelectBot={onSelectBot}
        onSelectMeetingTable={onSelectMeetingTable}
        onCameraStep={stepCameraOrbit}
        onResetCamera={() => {
          onSelectBot(null);
          cameraGoalRef.current = planRef.current.overviewCamera;
        }}
      />
    </div>
  );
}
