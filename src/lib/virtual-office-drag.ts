import * as THREE from "three";

import type { DragDropTarget } from "@/components/VirtualOfficeSceneHud";
import type { OfficeBotInput, OfficePlan } from "@/lib/virtual-office";
import type { AnimatedBotRig } from "@/lib/virtual-office-rigs";

export type SceneHit =
  | { kind: "bot"; botId: string; draggable: boolean }
  | { kind: "kpi-wall" }
  | { kind: "meeting-table" }
  | null;

export interface DragVisualController {
  group: THREE.Group;
  sync: (
    sourceBotId: string,
    target: DragDropTarget,
    floorX: number,
    floorZ: number,
    pulseElapsed: number,
    rigs: readonly AnimatedBotRig[],
    plan: OfficePlan,
  ) => void;
  clear: () => void;
}

export function createDragVisualController(): DragVisualController {
  const dragGroup = new THREE.Group();
  dragGroup.visible = false;

  const dragArcPointsCount = 29;
  const dragArcPositions = new Float32Array(dragArcPointsCount * 3);
  const dragArcGeo = new THREE.BufferGeometry();
  dragArcGeo.setAttribute("position", new THREE.BufferAttribute(dragArcPositions, 3));
  const dragArcMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.92 });
  const dragArcLine = new THREE.Line(dragArcGeo, dragArcMat);
  dragGroup.add(dragArcLine);

  const dragRingMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
  });
  const dragRingMesh = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.86, 40), dragRingMat);
  dragRingMesh.rotation.x = -Math.PI / 2;
  dragGroup.add(dragRingMesh);

  const dragZonePositions = new Float32Array(5 * 3);
  const dragZoneGeo = new THREE.BufferGeometry();
  dragZoneGeo.setAttribute("position", new THREE.BufferAttribute(dragZonePositions, 3));
  const dragZoneMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95 });
  const dragZoneLoop = new THREE.Line(dragZoneGeo, dragZoneMat);
  dragZoneLoop.visible = false;
  dragGroup.add(dragZoneLoop);

  const arcStartVec = new THREE.Vector3();
  const arcMidVec = new THREE.Vector3();
  const arcEndVec = new THREE.Vector3();
  const arcPointVec = new THREE.Vector3();
  const arcCurve = new THREE.QuadraticBezierCurve3(arcStartVec, arcMidVec, arcEndVec);

  return {
    group: dragGroup,
    sync(sourceBotId, target, floorX, floorZ, pulseElapsed, rigs, plan) {
      const sourceRig = rigs.find((item) => item.botId === sourceBotId);
      const sourceDesk = plan.desks.find((item) => item.bot.id === sourceBotId);
      const startX = sourceRig?.currentX ?? sourceDesk?.x ?? 0;
      const startY = (sourceRig?.currentY ?? 0.44) + 0.52;
      const startZ = sourceRig?.currentZ ?? sourceDesk?.z ?? 0;

      let endX = floorX;
      let endY = 0.1;
      let endZ = floorZ;
      let colorHex = 0x94a3b8;

      if (target?.kind === "pair") {
        const targetRig = rigs.find((item) => item.botId === target.targetBotId);
        const targetDesk = plan.desks.find((item) => item.bot.id === target.targetBotId);
        endX = targetRig?.currentX ?? targetDesk?.x ?? floorX;
        endY = (targetRig?.currentY ?? 0.44) + 0.52;
        endZ = targetRig?.currentZ ?? targetDesk?.z ?? floorZ;
        colorHex = 0x10b981;
      } else if (target?.kind === "meeting-table") {
        endX = plan.meetingTable.x;
        endY = 0.82;
        endZ = plan.meetingTable.z;
        colorHex = 0xa855f7;
      } else if (target?.kind === "move-zone") {
        colorHex = 0x38bdf8;
      }

      arcStartVec.set(startX, startY, startZ);
      arcEndVec.set(endX, endY, endZ);
      const dist = arcStartVec.distanceTo(arcEndVec);
      arcMidVec.copy(arcStartVec).lerp(arcEndVec, 0.5);
      arcMidVec.y = Math.max(startY, endY) + Math.min(2.3, Math.max(0.75, dist * 0.28));

      for (let i = 0; i < dragArcPointsCount; i++) {
        arcCurve.getPoint(i / (dragArcPointsCount - 1), arcPointVec);
        dragArcPositions[i * 3] = arcPointVec.x;
        dragArcPositions[i * 3 + 1] = arcPointVec.y;
        dragArcPositions[i * 3 + 2] = arcPointVec.z;
      }
      dragArcGeo.attributes.position!.needsUpdate = true;
      dragArcMat.color.setHex(colorHex);

      dragRingMat.color.setHex(colorHex);
      dragRingMesh.position.set(endX, 0.044, endZ);
      const pulse = 1 + Math.sin(pulseElapsed * 7.5) * 0.07;
      const baseRingScale = target?.kind === "meeting-table" ? 2.05 : target?.kind === "pair" ? 1.05 : 0.72;
      dragRingMesh.scale.setScalar(baseRingScale * pulse);
      dragRingMesh.rotation.z = pulseElapsed * 1.4;

      if (target?.kind === "move-zone") {
        const halfW = target.width / 2 + 0.08;
        const halfD = target.depth / 2 + 0.08;
        const corners: Array<[number, number]> = [
          [target.x - halfW, target.z - halfD],
          [target.x + halfW, target.z - halfD],
          [target.x + halfW, target.z + halfD],
          [target.x - halfW, target.z + halfD],
          [target.x - halfW, target.z - halfD],
        ];
        corners.forEach(([cx, cz], idx) => {
          dragZonePositions[idx * 3] = cx;
          dragZonePositions[idx * 3 + 1] = 0.048;
          dragZonePositions[idx * 3 + 2] = cz;
        });
        dragZoneGeo.attributes.position!.needsUpdate = true;
        dragZoneLoop.visible = true;
      } else {
        dragZoneLoop.visible = false;
      }

      dragGroup.visible = true;
    },
    clear() {
      dragGroup.visible = false;
      dragZoneLoop.visible = false;
    },
  };
}

export function resolveOfficeSceneHit(
  raycaster: THREE.Raycaster,
  pickables: THREE.Object3D[],
): SceneHit {
  const hits = raycaster.intersectObjects(pickables, true);
  for (const hit of hits) {
    let cursor: THREE.Object3D | null = hit.object;
    let draggable = false;
    while (cursor) {
      if (typeof cursor.userData.dragBotId === "string") draggable = true;
      if (typeof cursor.userData.botId === "string") {
        return { kind: "bot", botId: cursor.userData.botId, draggable };
      }
      if (cursor.userData.kpiWall === true) return { kind: "kpi-wall" };
      if (cursor.userData.meetingTable === true) return { kind: "meeting-table" };
      cursor = cursor.parent;
    }
  }
  return null;
}

export function resolveOfficeDropAt<T extends OfficeBotInput>(opts: {
  sourceBotId: string;
  clientX: number;
  clientY: number;
  rayReady: boolean;
  raycaster: THREE.Raycaster;
  floorPlane: THREE.Plane;
  floorHitVec: THREE.Vector3;
  plan: OfficePlan<T>;
  canManage: boolean;
  rigs: readonly AnimatedBotRig[];
  pickables: THREE.Object3D[];
  zoneRugs: THREE.Object3D[];
  overlayMap: Map<string, HTMLDivElement>;
  zoneLabelMap: Map<string, HTMLDivElement>;
  meetingBadgeEl: HTMLButtonElement | null;
}): { target: DragDropTarget; floorX: number; floorZ: number } {
  const {
    sourceBotId,
    clientX,
    clientY,
    rayReady,
    raycaster,
    floorPlane,
    floorHitVec,
    plan,
    canManage,
    rigs,
    pickables,
    zoneRugs,
    overlayMap,
    zoneLabelMap,
    meetingBadgeEl,
  } = opts;

  const sourceDesk = plan.desks.find((item) => item.bot.id === sourceBotId);
  const fallbackX = sourceDesk?.x ?? 0;
  const fallbackZ = sourceDesk?.z ?? 0;

  for (const [candidateBotId, pinEl] of overlayMap.entries()) {
    if (candidateBotId === sourceBotId || pinEl.style.opacity === "0") continue;
    const pinRect = pinEl.getBoundingClientRect();
    if (
      pinRect.width > 0
      && clientX >= pinRect.left - 6
      && clientX <= pinRect.right + 6
      && clientY >= pinRect.top - 6
      && clientY <= pinRect.bottom + 6
    ) {
      const rig = rigs.find((item) => item.botId === candidateBotId);
      return {
        target: { kind: "pair", targetBotId: candidateBotId },
        floorX: rig?.currentX ?? fallbackX,
        floorZ: rig?.currentZ ?? fallbackZ,
      };
    }
  }

  if (!rayReady) {
    return { target: null, floorX: fallbackX, floorZ: fallbackZ };
  }

  const hasPlaneHit = raycaster.ray.intersectPlane(floorPlane, floorHitVec) !== null;
  const floorX = hasPlaneHit ? floorHitVec.x : fallbackX;
  const floorZ = hasPlaneHit ? floorHitVec.z : fallbackZ;

  const meshHits = raycaster.intersectObjects(pickables, true);
  for (const hit of meshHits) {
    let cursor: THREE.Object3D | null = hit.object;
    while (cursor) {
      if (typeof cursor.userData.botId === "string" && cursor.userData.botId !== sourceBotId) {
        return {
          target: { kind: "pair", targetBotId: cursor.userData.botId },
          floorX,
          floorZ,
        };
      }
      cursor = cursor.parent;
    }
  }

  if (hasPlaneHit) {
    for (const rig of rigs) {
      if (rig.botId === sourceBotId) continue;
      if (
        Math.hypot(floorX - rig.currentX, floorZ - rig.currentZ) <= 0.92
        || Math.hypot(floorX - rig.deskX, floorZ - rig.deskZ) <= 1.08
      ) {
        return {
          target: { kind: "pair", targetBotId: rig.botId },
          floorX,
          floorZ,
        };
      }
    }
  }

  if (plan.desks.length >= 2) {
    if (meetingBadgeEl && meetingBadgeEl.style.opacity !== "0") {
      const badgeRect = meetingBadgeEl.getBoundingClientRect();
      if (
        badgeRect.width > 0
        && clientX >= badgeRect.left - 10
        && clientX <= badgeRect.right + 10
        && clientY >= badgeRect.top - 10
        && clientY <= badgeRect.bottom + 10
      ) {
        return {
          target: { kind: "meeting-table" },
          floorX: plan.meetingTable.x,
          floorZ: plan.meetingTable.z,
        };
      }
    }

    for (const hit of meshHits) {
      let cursor: THREE.Object3D | null = hit.object;
      while (cursor) {
        if (cursor.userData.meetingTable === true) {
          return {
            target: { kind: "meeting-table" },
            floorX: plan.meetingTable.x,
            floorZ: plan.meetingTable.z,
          };
        }
        cursor = cursor.parent;
      }
    }

    if (
      hasPlaneHit
      && Math.hypot(floorX - plan.meetingTable.x, floorZ - plan.meetingTable.z) <= 1.92
    ) {
      return {
        target: { kind: "meeting-table" },
        floorX: plan.meetingTable.x,
        floorZ: plan.meetingTable.z,
      };
    }
  }

  if (canManage && sourceDesk) {
    for (const zone of plan.zones) {
      if (zone.key === sourceDesk.sectionKey) continue;
      const badgeEl = zoneLabelMap.get(zone.key || "__general__");
      if (badgeEl && badgeEl.style.opacity !== "0") {
        const badgeRect = badgeEl.getBoundingClientRect();
        if (
          badgeRect.width > 0
          && clientX >= badgeRect.left - 8
          && clientX <= badgeRect.right + 8
          && clientY >= badgeRect.top - 8
          && clientY <= badgeRect.bottom + 8
        ) {
          return {
            target: {
              kind: "move-zone",
              zoneKey: zone.key,
              zoneName: zone.name,
              x: zone.x,
              z: zone.z,
              width: zone.width,
              depth: zone.depth,
            },
            floorX: zone.x,
            floorZ: zone.z,
          };
        }
      }
    }

    const rugHits = raycaster.intersectObjects(zoneRugs, false);
    for (const rugHit of rugHits) {
      const zKey = rugHit.object.userData.zoneKey;
      if (typeof zKey === "string" && zKey !== sourceDesk.sectionKey) {
        const zone = plan.zones.find((item) => item.key === zKey);
        if (zone) {
          return {
            target: {
              kind: "move-zone",
              zoneKey: zone.key,
              zoneName: zone.name,
              x: zone.x,
              z: zone.z,
              width: zone.width,
              depth: zone.depth,
            },
            floorX,
            floorZ,
          };
        }
      }
    }

    if (hasPlaneHit) {
      for (const zone of plan.zones) {
        if (zone.key === sourceDesk.sectionKey) continue;
        if (
          Math.abs(floorX - zone.x) <= zone.width / 2 + 0.16
          && Math.abs(floorZ - zone.z) <= zone.depth / 2 + 0.16
        ) {
          return {
            target: {
              kind: "move-zone",
              zoneKey: zone.key,
              zoneName: zone.name,
              x: zone.x,
              z: zone.z,
              width: zone.width,
              depth: zone.depth,
            },
            floorX,
            floorZ,
          };
        }
      }
    }
  }

  return { target: null, floorX, floorZ };
}
