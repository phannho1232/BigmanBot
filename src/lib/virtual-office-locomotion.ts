import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  buildWalkWaypoints,
  type OfficeBotInput,
  type OfficePlan,
} from "@/lib/virtual-office";
import { drawProceduralMonitorScreen } from "@/lib/virtual-office-canvas";
import type {
  AnimatedBotRig,
  AnimatedConversationRing,
  AnimatedHandoffPacket,
} from "@/lib/virtual-office-rigs";

export function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

export function lerpAngle(current: number, target: number, alpha: number): number {
  const delta = normalizeAngle(target - current);
  return current + delta * Math.min(1, Math.max(0, alpha));
}

export function syncControlsPose(controls: OrbitControls, camera: THREE.PerspectiveCamera) {
  const px = camera.position.x;
  const py = camera.position.y;
  const pz = camera.position.z;
  const tx = controls.target.x;
  const ty = controls.target.y;
  const tz = controls.target.z;
  const prevDamping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.position.set(px, py, pz);
  controls.target.set(tx, ty, tz);
  controls.update();
  controls.enableDamping = prevDamping;
}

export function detectDocumentDark(): boolean {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return true;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-app").trim()
    || getComputedStyle(document.body).backgroundColor;
  const rgb = /(\d+)\D+(\d+)\D+(\d+)/.exec(bg);
  if (!rgb) {
    const skin = document.documentElement.dataset.skin ?? "";
    return skin !== "daylight" && skin !== "paper" && skin !== "light";
  }
  const luminance = (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255;
  return luminance < 0.52;
}

export function stepOfficeRigsAndConnections<T extends OfficeBotInput>(opts: {
  rigs: AnimatedBotRig[];
  packets: AnimatedHandoffPacket[];
  convRings: AnimatedConversationRing[];
  plan: OfficePlan<T>;
  selectedBotId: string | null;
  dt: number;
  elapsed: number;
  redrawScreens: boolean;
}) {
  const { rigs, packets, convRings, plan, selectedBotId, dt, elapsed, redrawScreens } = opts;

  const obstacles = [
    ...plan.desks.map((d) => ({ x: d.x, z: d.z + 0.1, radius: 1.02, ownerBotId: d.bot.id })),
    { x: plan.meetingTable.x, z: plan.meetingTable.z, radius: 0.92 },
  ];

  for (const rig of rigs) {
    const desk = plan.desks.find((item) => item.bot.id === rig.botId);
    if (!desk) continue;

    const tLocal = elapsed + rig.phaseOffset;
    const selected = selectedBotId === rig.botId;
    rig.selectionRing.visible = selected;
    if (selected) {
      rig.selectionRing.position.set(rig.currentX, 0.034, rig.currentZ);
      rig.selectionRing.rotation.z = elapsed * 0.85;
    }

    const conv = desk.conversation;
    if (conv) {
      if (rig.activeConversationId !== conv.conversationId || rig.mode === "seated" || rig.mode === "walking_home") {
        rig.activeConversationId = conv.conversationId;
        rig.route = conv.waypoints.length > 0 ? conv.waypoints.map((pt) => ({ ...pt })) : [{ ...conv.standPoint }];
        rig.routeIndex = 0;
        rig.mode = "walking_out";
      } else if (rig.mode === "conversing") {
        const drift = Math.hypot(conv.standPoint.x - rig.currentX, conv.standPoint.z - rig.currentZ);
        if (drift > 0.35) {
          rig.route = [{ ...conv.standPoint }];
          rig.routeIndex = 0;
          rig.mode = "walking_out";
        }
      }
    } else if (rig.mode === "walking_out" || rig.mode === "conversing") {
      rig.activeConversationId = null;
      const returnWaypoints = buildWalkWaypoints(
        { x: rig.currentX, z: rig.currentZ },
        rig.stepOutPoint,
        obstacles,
        rig.botId,
      );
      rig.route = [...returnWaypoints, { x: rig.seatWorldX, z: rig.seatWorldZ }];
      rig.routeIndex = 0;
      rig.mode = "walking_home";
    }

    const walkSpeed = 2.4;
    let isMoving = false;

    if (rig.mode === "walking_out") {
      rig.seatBlend = Math.max(0, rig.seatBlend - dt * 3.8);
      if (rig.seatBlend < 0.35 && rig.routeIndex < rig.route.length) {
        const targetPt = rig.route[rig.routeIndex]!;
        const dx = targetPt.x - rig.currentX;
        const dz = targetPt.z - rig.currentZ;
        const dist = Math.hypot(dx, dz);
        const step = walkSpeed * dt;
        if (dist <= step + 0.03) {
          rig.currentX = targetPt.x;
          rig.currentZ = targetPt.z;
          rig.routeIndex += 1;
          if (rig.routeIndex >= rig.route.length) {
            rig.mode = "conversing";
          }
        } else {
          rig.currentX += (dx / dist) * step;
          rig.currentZ += (dz / dist) * step;
          rig.currentRotY = lerpAngle(rig.currentRotY, Math.atan2(dx, dz), dt * 11);
          rig.walkDistance += step;
          isMoving = true;
        }
      }
    } else if (rig.mode === "conversing") {
      rig.seatBlend = Math.max(0, rig.seatBlend - dt * 4);
      if (conv) {
        rig.currentX += (conv.standPoint.x - rig.currentX) * Math.min(1, dt * 7);
        rig.currentZ += (conv.standPoint.z - rig.currentZ) * Math.min(1, dt * 7);
        rig.currentRotY = lerpAngle(rig.currentRotY, conv.faceAngleY, dt * 8.5);
      }
    } else if (rig.mode === "walking_home") {
      rig.seatBlend = Math.max(0, rig.seatBlend - dt * 4);
      if (rig.routeIndex < rig.route.length) {
        const targetPt = rig.route[rig.routeIndex]!;
        const dx = targetPt.x - rig.currentX;
        const dz = targetPt.z - rig.currentZ;
        const dist = Math.hypot(dx, dz);
        const step = walkSpeed * dt;
        if (dist <= step + 0.03) {
          rig.currentX = targetPt.x;
          rig.currentZ = targetPt.z;
          rig.routeIndex += 1;
          if (rig.routeIndex >= rig.route.length) {
            rig.mode = "seated";
          }
        } else {
          rig.currentX += (dx / dist) * step;
          rig.currentZ += (dz / dist) * step;
          rig.currentRotY = lerpAngle(rig.currentRotY, Math.atan2(dx, dz), dt * 11);
          rig.walkDistance += step;
          isMoving = true;
        }
      } else {
        rig.mode = "seated";
      }
    } else {
      rig.currentX += (rig.seatWorldX - rig.currentX) * Math.min(1, dt * 9);
      rig.currentZ += (rig.seatWorldZ - rig.currentZ) * Math.min(1, dt * 9);
      rig.seatBlend = Math.min(1, rig.seatBlend + dt * 3.6);
    }

    const chairPush = 1 - rig.seatBlend;
    rig.chairGroup.position.x = -0.08 - chairPush * 0.1;
    rig.chairGroup.position.z = 0.56 + chairPush * 0.16;

    rig.tabletProp.visible = false;
    rig.heldMug.visible = false;
    rig.deskMug.visible = true;
    rig.thoughtGroup.visible = false;
    rig.codeSparksGroup.visible = false;

    if (isMoving) {
      const stride = rig.walkDistance * 5.2;
      const bob = Math.abs(Math.sin(stride)) * 0.055;
      rig.currentY = 0.28 + bob;
      rig.bodyGroup.position.set(0, 0, 0);
      rig.bodyGroup.rotation.set(0.09, 0, Math.sin(stride) * 0.045);
      rig.leftLeg.rotation.set(Math.sin(stride) * 0.65, 0, 0);
      rig.rightLeg.rotation.set(-Math.sin(stride) * 0.65, 0, 0);
      rig.leftArm.rotation.set(-0.2 - Math.sin(stride) * 0.52, 0, -0.08);
      rig.rightArm.rotation.set(-0.2 + Math.sin(stride) * 0.52, 0, 0.08);
      rig.headGroup.rotation.set(-0.04, Math.sin(stride * 0.5) * 0.1, 0);
      rig.chairGroup.rotation.y = chairPush * 0.24;
      rig.eyeMat.color.setHex(0x38bdf8);
      rig.statusRing.visible = true;
      rig.statusRing.position.set(rig.currentX, 0.03, rig.currentZ);
      rig.statusRingMat.color.setHex(0x38bdf8);
      rig.statusRingMat.opacity = 0.36;
      rig.lampBulbMat.emissiveIntensity = 0.7;
    } else if (rig.mode === "conversing" && conv) {
      const turnWave = Math.sin(elapsed * 1.45 + (conv.isSpeaker ? 0 : Math.PI));
      const activelySpeaking = conv.isSpeaker ? turnWave > -0.45 : turnWave > 0.35;
      rig.currentY = 0.28 + Math.sin(tLocal * 3.4) * 0.014;
      rig.leftLeg.rotation.set(Math.sin(tLocal * 1.3) * 0.05, 0, -0.04);
      rig.rightLeg.rotation.set(-Math.sin(tLocal * 1.3) * 0.05, 0, 0.04);
      rig.chairGroup.rotation.y = 0.26;

      if (activelySpeaking) {
        rig.bodyGroup.position.y = Math.abs(Math.sin(tLocal * 5.8)) * 0.018;
        rig.bodyGroup.rotation.set(0.06 + Math.sin(tLocal * 3.2) * 0.03, Math.sin(tLocal * 2.4) * 0.1, 0);
        rig.headGroup.rotation.set(
          Math.sin(tLocal * 6.4) * 0.08,
          Math.sin(tLocal * 3.1) * 0.18,
          Math.sin(tLocal * 2.7) * 0.06,
        );
        rig.leftArm.rotation.set(
          -1.08 + Math.sin(tLocal * 7.5) * 0.34,
          0.18,
          -0.22 - Math.abs(Math.cos(tLocal * 5.2)) * 0.18,
        );
        rig.rightArm.rotation.set(
          -1.14 + Math.cos(tLocal * 7.8) * 0.36,
          -0.18,
          0.22 + Math.abs(Math.sin(tLocal * 5.6)) * 0.18,
        );
      } else {
        rig.bodyGroup.position.y = 0;
        rig.bodyGroup.rotation.set(0.02, Math.sin(tLocal * 1.4) * 0.06, 0);
        rig.headGroup.rotation.set(
          0.05 + Math.sin(tLocal * 4.8) * 0.095,
          Math.sin(tLocal * 1.6) * 0.1,
          Math.sin(tLocal * 1.9) * 0.04,
        );
        const agreeRaise = Math.max(0, Math.sin(tLocal * 1.9));
        rig.leftArm.rotation.set(-0.35, 0.12, -0.08);
        rig.rightArm.rotation.set(-0.45 - agreeRaise * 0.55, -0.14, 0.1);
      }

      rig.eyeMat.color.setHex(0x34d399);
      rig.statusRing.visible = true;
      rig.statusRing.position.set(rig.currentX, 0.03, rig.currentZ);
      rig.statusRingMat.color.setHex(0x38bdf8);
      rig.statusRingMat.opacity = 0.34 + Math.sin(tLocal * 4) * 0.12;
      rig.lampBulbMat.emissiveIntensity = 0.85;
    } else {
      rig.currentY = 0.28 + rig.seatBlend * 0.16;
      const kneeBend = -1.42 * rig.seatBlend;
      rig.leftLeg.rotation.set(kneeBend, 0, -0.05);
      rig.rightLeg.rotation.set(kneeBend, 0, 0.05);
      rig.statusRing.position.set(rig.seatWorldX, 0.032, rig.seatWorldZ);

      const action = desk.workAction;
      if (action === "coding" || action === "replying" || action === "screen") {
        const mouseCycle = Math.sin(tLocal * 1.35) > 0.52;
        const swivel = Math.sin(tLocal * 1.2) * 0.05;
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY + swivel, dt * 9);
        rig.chairGroup.rotation.y = swivel;
        rig.bodyGroup.position.y = Math.sin(tLocal * 9.5) * 0.013;
        rig.bodyGroup.rotation.set(0.14, 0, 0);
        rig.headGroup.rotation.set(
          0.12 + Math.sin(tLocal * 5.8) * 0.045,
          (mouseCycle ? -0.12 : 0) + Math.sin(tLocal * 2.4) * 0.16,
          0,
        );
        rig.leftArm.rotation.set(-0.92 + Math.sin(tLocal * 21) * 0.24, 0.08, -0.06);
        if (mouseCycle) {
          rig.rightArm.rotation.set(-0.88 + Math.sin(tLocal * 9) * 0.06, -0.28, 0.18 + Math.sin(tLocal * 5) * 0.06);
        } else {
          rig.rightArm.rotation.set(-0.92 + Math.cos(tLocal * 21) * 0.24, -0.08, 0.06);
        }
        rig.codeSparksGroup.visible = true;
        rig.codeSparksGroup.children.forEach((spark, sIdx) => {
          const p = (elapsed * 1.35 + sIdx * 0.33) % 1;
          spark.position.y = 0.84 + p * 0.36;
          spark.scale.setScalar(Math.sin(p * Math.PI) * 1.05);
          spark.rotation.y = elapsed * 2.8 + sIdx;
        });
        rig.eyeMat.color.setHex(0x38bdf8);
        rig.statusRing.visible = true;
        rig.statusRingMat.color.setHex(0x10b981);
        rig.statusRingMat.opacity = 0.36 + Math.sin(tLocal * 4.5) * 0.14;
        rig.lampBulbMat.emissiveIntensity = 1.55 + Math.sin(tLocal * 6) * 0.25;
        rig.lampShadeMat.emissive.setHex(0x10b981);
      } else if (action === "terminal") {
        const inspectPause = Math.sin(tLocal * 1.9) > 0.35;
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY, dt * 9);
        rig.chairGroup.rotation.y = 0;
        rig.bodyGroup.position.y = inspectPause ? 0 : Math.sin(tLocal * 12) * 0.012;
        rig.bodyGroup.rotation.set(inspectPause ? 0.21 : 0.15, 0, 0);
        rig.headGroup.rotation.set(
          inspectPause ? 0.06 + Math.sin(tLocal * 7) * 0.05 : 0.15,
          Math.sin(tLocal * 3.6) * 0.12,
          0,
        );
        rig.leftArm.rotation.set(inspectPause ? -0.78 : -0.95 + Math.sin(tLocal * 24) * 0.26, 0.06, -0.05);
        rig.rightArm.rotation.set(inspectPause ? -0.78 : -0.95 + Math.cos(tLocal * 24) * 0.26, -0.06, 0.05);
        rig.codeSparksGroup.visible = true;
        rig.codeSparksGroup.children.forEach((spark, sIdx) => {
          const p = (elapsed * 1.8 + sIdx * 0.33) % 1;
          spark.position.y = 0.84 + p * 0.34;
          spark.scale.setScalar(Math.sin(p * Math.PI));
        });
        rig.eyeMat.color.setHex(0x4ade80);
        rig.statusRing.visible = true;
        rig.statusRingMat.color.setHex(0x10b981);
        rig.statusRingMat.opacity = 0.38 + Math.sin(tLocal * 5.2) * 0.14;
        rig.lampBulbMat.emissiveIntensity = 1.5;
      } else if (action === "researching") {
        const swivel = Math.sin(tLocal * 0.95) * 0.24;
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY + swivel, dt * 7);
        rig.chairGroup.rotation.y = swivel;
        rig.bodyGroup.position.y = Math.sin(tLocal * 2.4) * 0.01;
        rig.bodyGroup.rotation.set(-0.06, 0, 0);
        const lookAtScreen = Math.sin(tLocal * 1.6) > 0.15;
        rig.headGroup.rotation.set(
          lookAtScreen ? 0.02 : 0.26,
          lookAtScreen ? -swivel * 0.65 : 0.18,
          Math.sin(tLocal * 1.4) * 0.05,
        );
        rig.tabletProp.visible = true;
        rig.leftArm.rotation.set(-1.18 + Math.sin(tLocal * 2.2) * 0.06, 0.28, -0.14);
        rig.rightArm.rotation.set(
          lookAtScreen ? -1.05 + Math.sin(tLocal * 4.5) * 0.12 : -1.15 + Math.sin(tLocal * 5.5) * 0.16,
          -0.22,
          0.1,
        );
        rig.eyeMat.color.setHex(0x38bdf8);
        rig.statusRing.visible = true;
        rig.statusRingMat.color.setHex(0x0ea5e9);
        rig.statusRingMat.opacity = 0.34 + Math.sin(tLocal * 3.4) * 0.12;
        rig.lampBulbMat.emissiveIntensity = 1.35;
      } else if (action === "thinking") {
        const swivel = Math.sin(tLocal * 0.72) * 0.3;
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY + swivel, dt * 6.5);
        rig.chairGroup.rotation.y = swivel;
        rig.bodyGroup.position.y = Math.sin(tLocal * 2) * 0.012;
        rig.bodyGroup.rotation.set(-0.1, 0, 0);
        rig.headGroup.rotation.set(-0.14 + Math.sin(tLocal * 1.8) * 0.05, Math.sin(tLocal * 1.2) * 0.16, 0.09);
        rig.leftArm.rotation.set(-0.62, 0.25, -0.15);
        rig.rightArm.rotation.set(-1.92 + Math.sin(tLocal * 3.2) * 0.06, -0.34, 0.24);
        rig.thoughtGroup.visible = true;
        rig.thoughtGroup.rotation.y = elapsed * 1.65;
        rig.thoughtGroup.position.y = 0.96 + Math.sin(tLocal * 3) * 0.04;
        rig.eyeMat.color.setHex(0xfbbf24);
        rig.statusRing.visible = true;
        rig.statusRingMat.color.setHex(0xa855f7);
        rig.statusRingMat.opacity = 0.34 + Math.sin(tLocal * 3.2) * 0.14;
        rig.lampBulbMat.emissiveIntensity = 1.25;
      } else if (action === "waiting") {
        const swivel = 0.42 + Math.sin(tLocal * 1.5) * 0.12;
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY + swivel, dt * 8);
        rig.chairGroup.rotation.y = swivel;
        rig.bodyGroup.position.y = Math.abs(Math.sin(tLocal * 3.8)) * 0.02;
        rig.bodyGroup.rotation.set(0, 0, Math.sin(tLocal * 3.8) * 0.05);
        rig.headGroup.rotation.set(-0.06, Math.sin(tLocal * 2.6) * 0.22, 0);
        rig.leftArm.rotation.set(-0.52, 0, -0.08);
        rig.rightArm.rotation.set(-2.55 + Math.sin(tLocal * 7.2) * 0.25, 0, 0.28 + Math.cos(tLocal * 7.2) * 0.28);
        rig.eyeMat.color.setHex(0xfbbf24);
        rig.statusRing.visible = true;
        rig.statusRingMat.color.setHex(0xf59e0b);
        rig.statusRingMat.opacity = 0.36 + Math.sin(tLocal * 4) * 0.18;
        rig.lampBulbMat.emissiveIntensity = 1.2 + Math.sin(tLocal * 4.5) * 0.4;
      } else if (action === "offline") {
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY, dt * 6);
        rig.chairGroup.rotation.y = 0;
        rig.bodyGroup.position.y = 0;
        rig.bodyGroup.rotation.set(0.18, 0, 0);
        rig.headGroup.rotation.set(0.32, 0, 0);
        rig.leftArm.rotation.set(-0.28, 0, -0.04);
        rig.rightArm.rotation.set(-0.28, 0, 0.04);
        rig.eyeMat.color.setHex(0xef4444);
        rig.statusRing.visible = false;
        rig.lampBulbMat.emissiveIntensity = 0.25;
      } else {
        const idleCycle = (tLocal * 0.065) % 1;
        const sippingCoffee = idleCycle > 0.72 && idleCycle < 0.9;
        const stretching = idleCycle > 0.34 && idleCycle < 0.44;
        const swivel = Math.sin(tLocal * 0.55) * 0.16;
        rig.currentRotY = lerpAngle(rig.currentRotY, rig.seatRotationY + swivel, dt * 6);
        rig.chairGroup.rotation.y = swivel;
        rig.bodyGroup.position.y = Math.sin(tLocal * 1.9) * 0.014;

        if (sippingCoffee) {
          const sipPhase = Math.sin(((idleCycle - 0.72) / 0.18) * Math.PI);
          rig.deskMug.visible = false;
          rig.heldMug.visible = true;
          rig.bodyGroup.rotation.set(-0.05 * sipPhase, 0, 0);
          rig.headGroup.rotation.set(-0.18 * sipPhase, 0, 0);
          rig.leftArm.rotation.set(-0.56, 0.08, -0.06);
          rig.rightArm.rotation.set(-0.6 - sipPhase * 1.22, -0.28 * sipPhase, 0.12);
        } else if (stretching) {
          const stretchPhase = Math.sin(((idleCycle - 0.34) / 0.1) * Math.PI);
          rig.bodyGroup.rotation.set(-0.12 * stretchPhase, 0, 0);
          rig.headGroup.rotation.set(-0.1 * stretchPhase, 0, 0);
          rig.leftArm.rotation.set(-0.58 - stretchPhase * 1.85, 0, -0.22 * stretchPhase);
          rig.rightArm.rotation.set(-0.58 - stretchPhase * 1.85, 0, 0.22 * stretchPhase);
        } else {
          rig.bodyGroup.rotation.set(0, 0, 0);
          rig.headGroup.rotation.set(Math.sin(tLocal * 1.1) * 0.04, Math.sin(tLocal * 0.78) * 0.28, 0);
          rig.leftArm.rotation.set(-0.58 + Math.sin(tLocal * 1.9) * 0.04, 0.05, -0.05);
          rig.rightArm.rotation.set(-0.58 + Math.cos(tLocal * 1.9) * 0.04, -0.05, 0.05);
        }

        rig.eyeMat.color.setHex(0x38bdf8);
        rig.statusRing.visible = false;
        rig.lampBulbMat.emissiveIntensity = 0.5;
      }
    }

    rig.botRoot.position.set(rig.currentX, rig.currentY, rig.currentZ);
    rig.botRoot.rotation.y = rig.currentRotY;

    const blinkCycle = (tLocal * 0.34) % 1;
    const eyeScaleY = desk.workAction === "offline" ? 0.16 : blinkCycle > 0.965 ? 0.12 : 1;
    rig.leftEye.scale.y = eyeScaleY;
    rig.rightEye.scale.y = eyeScaleY;

    if (redrawScreens && !rig.hasLiveFrame) {
      drawProceduralMonitorScreen(rig.screenCanvas, desk.bodyHex, desk.screenState, desk.workAction, elapsed);
      rig.screenTexture.needsUpdate = true;
    }
  }

  for (const packet of packets) {
    const u = (elapsed * packet.speed + packet.offset) % 1;
    packet.curve.getPoint(u, packet.mesh.position);
  }

  for (const cRing of convRings) {
    cRing.ring.rotation.z = elapsed * 0.7 + cRing.phase;
    cRing.mat.opacity = 0.28 + Math.sin(elapsed * 3.2 + cRing.phase) * 0.12;
  }
}
