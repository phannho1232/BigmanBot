import * as THREE from "three";

import { t } from "@/lib/i18n";
import type {
  OfficeBotInput,
  OfficeDesk,
  OfficePlan,
  OfficePoint2D,
} from "@/lib/virtual-office";
import type { OfficeKpiSummary } from "@/lib/virtual-office-kpi";
import {
  buildKpiWallGroup,
  drawProceduralMonitorScreen,
  type KpiWallRig,
} from "@/lib/virtual-office-canvas";

export type LocomotionMode = "seated" | "walking_out" | "conversing" | "walking_home";

export interface AnimatedBotRig {
  botId: string;
  deskX: number;
  deskZ: number;
  deskRotationY: number;
  seatWorldX: number;
  seatWorldZ: number;
  seatRotationY: number;
  stepOutPoint: OfficePoint2D;
  bodyHex: string;
  botRoot: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  eyeMat: THREE.MeshBasicMaterial;
  chairGroup: THREE.Group;
  deskMug: THREE.Mesh;
  heldMug: THREE.Mesh;
  tabletProp: THREE.Group;
  thoughtGroup: THREE.Group;
  codeSparksGroup: THREE.Group;
  lampBulbMat: THREE.MeshStandardMaterial;
  lampShadeMat: THREE.MeshStandardMaterial;
  statusRing: THREE.Mesh;
  statusRingMat: THREE.MeshBasicMaterial;
  selectionRing: THREE.Mesh;
  screenCanvas: HTMLCanvasElement;
  screenTexture: THREE.CanvasTexture;
  loadedFrameUrl?: string;
  hasLiveFrame: boolean;
  phaseOffset: number;
  mode: LocomotionMode;
  activeConversationId: string | null;
  route: OfficePoint2D[];
  routeIndex: number;
  currentX: number;
  currentZ: number;
  currentY: number;
  currentRotY: number;
  seatBlend: number;
  walkDistance: number;
}

export interface AnimatedHandoffPacket {
  curve: THREE.QuadraticBezierCurve3;
  mesh: THREE.Mesh;
  speed: number;
  offset: number;
}

export interface AnimatedConversationRing {
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
}

export function localToWorldPoint(originX: number, originZ: number, rotationY: number, lx: number, lz: number): OfficePoint2D {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    x: originX + lx * cos + lz * sin,
    z: originZ - lx * sin + lz * cos,
  };
}

export function disposeSceneResources(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

export function defaultBubbleForAction(desk: OfficeDesk, botNames: Readonly<Record<string, string>>): string | null {
  if (desk.workAction === "talking" && desk.conversation) {
    if (desk.conversation.dialogueText) return desk.conversation.dialogueText;
    if (desk.conversation.partnerBotId) {
      const partnerName = botNames[desk.conversation.partnerBotId] ?? desk.conversation.partnerBotId;
      return t("office3d.activity.talkingTo", { name: partnerName });
    }
    return t("office3d.activity.typing");
  }
  if (desk.activityText) return desk.activityText;
  switch (desk.workAction) {
    case "coding":
      return t("office3d.activity.coding");
    case "terminal":
      return t("office3d.activity.terminal");
    case "researching":
      return t("office3d.activity.researching");
    case "thinking":
      return t("office3d.activity.thinking");
    case "replying":
      return t("office3d.activity.replying");
    case "screen":
      return t("office3d.activity.screen");
    case "waiting":
      return t("office3d.activity.waiting");
    default:
      return null;
  }
}

function buildPottedPlant(x: number, z: number, scale = 1): THREE.Group {
  const plant = new THREE.Group();
  plant.position.set(x, 0, z);
  plant.scale.setScalar(scale);

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.21, 0.42, 10),
    new THREE.MeshStandardMaterial({ color: 0xd97757, roughness: 0.78 }),
  );
  pot.position.y = 0.21;
  pot.castShadow = true;
  pot.receiveShadow = true;
  plant.add(pot);

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x3b2f2f, roughness: 0.95 }),
  );
  soil.position.y = 0.41;
  plant.add(soil);

  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.65 });
  const foliageLightMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6 });
  const clusters: Array<[number, number, number, number, boolean]> = [
    [0, 0.68, 0, 0.28, false],
    [-0.16, 0.84, 0.1, 0.22, true],
    [0.17, 0.88, -0.08, 0.23, false],
    [0.02, 1.04, 0.04, 0.2, true],
  ];
  for (const [cx, cy, cz, radius, light] of clusters) {
    const leaf = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), light ? foliageLightMat : foliageMat);
    leaf.position.set(cx, cy, cz);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  return plant;
}

function buildCoffeeBar(x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.82, 0.68),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.65 }),
  );
  cabinet.position.y = 0.41;
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  group.add(cabinet);

  const counterTop = new THREE.Mesh(
    new THREE.BoxGeometry(2.18, 0.07, 0.74),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35 }),
  );
  counterTop.position.y = 0.855;
  counterTop.castShadow = true;
  group.add(counterTop);

  const espresso = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.44, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.45, roughness: 0.35 }),
  );
  espresso.position.set(-0.48, 1.11, -0.04);
  espresso.castShadow = true;
  group.add(espresso);

  const waterCoolerBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.86, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }),
  );
  waterCoolerBase.position.set(1.48, 0.43, 0);
  waterCoolerBase.castShadow = true;
  group.add(waterCoolerBase);

  const waterJug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.48, 12),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65, roughness: 0.15 }),
  );
  waterJug.position.set(1.48, 1.1, 0);
  group.add(waterJug);

  return group;
}

function buildDiscussionLounge(x: number, z: number, isNight: boolean): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.userData.meetingTable = true;

  const rug = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.75, 0.024, 32),
    new THREE.MeshStandardMaterial({
      color: isNight ? 0x1e293b : 0xe2e8f0,
      roughness: 0.92,
    }),
  );
  rug.position.y = 0.012;
  rug.receiveShadow = true;
  rug.userData.meetingTable = true;
  group.add(rug);

  const rugTrim = new THREE.Mesh(
    new THREE.RingGeometry(1.68, 1.76, 36),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  );
  rugTrim.rotation.x = -Math.PI / 2;
  rugTrim.position.y = 0.026;
  rugTrim.userData.meetingTable = true;
  group.add(rugTrim);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.28, 0.72, 14),
    new THREE.MeshStandardMaterial({ color: isNight ? 0x0f172a : 0x475569, metalness: 0.5, roughness: 0.4 }),
  );
  pedestal.position.y = 0.36;
  pedestal.castShadow = true;
  pedestal.userData.meetingTable = true;
  group.add(pedestal);

  const tabletop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.76, 0.74, 0.065, 24),
    new THREE.MeshStandardMaterial({ color: isNight ? 0x334155 : 0xf8fafc, roughness: 0.45 }),
  );
  tabletop.position.y = 0.74;
  tabletop.castShadow = true;
  tabletop.receiveShadow = true;
  tabletop.userData.meetingTable = true;
  group.add(tabletop);

  const holoHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.19, 0.04, 16),
    new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: new THREE.Color(0x0284c7),
      emissiveIntensity: 0.65,
      roughness: 0.25,
    }),
  );
  holoHub.position.y = 0.79;
  holoHub.userData.meetingTable = true;
  group.add(holoHub);

  return group;
}

export function populateOfficeWorldGroup<T extends OfficeBotInput>(opts: {
  scene: THREE.Scene;
  worldGroup: THREE.Group;
  plan: OfficePlan<T>;
  kpi: OfficeKpiSummary;
  isNight: boolean;
  selectedBotId: string | null;
}): {
  rigs: AnimatedBotRig[];
  pickables: THREE.Object3D[];
  zoneRugs: THREE.Object3D[];
  kpiWall: KpiWallRig;
} {
  const { scene, worldGroup, plan, kpi, isNight, selectedBotId } = opts;
  const rigs: AnimatedBotRig[] = [];
  const pickables: THREE.Object3D[] = [];
  const zoneRugs: THREE.Object3D[] = [];

  scene.background = new THREE.Color(isNight ? 0x0b1120 : 0xeef2f7);
  scene.fog = new THREE.FogExp2(isNight ? 0x0b1120 : 0xeef2f7, 0.011);

  const hemi = new THREE.HemisphereLight(
    isNight ? 0x93c5fd : 0xffffff,
    isNight ? 0x1e293b : 0xcbd5e1,
    isNight ? 0.74 : 1.06,
  );
  hemi.position.set(0, 18, 0);
  worldGroup.add(hemi);

  const sun = new THREE.DirectionalLight(isNight ? 0xc7d2fe : 0xfffbeb, isNight ? 1.18 : 1.65);
  sun.position.set(14, 22, 16);
  sun.castShadow = true;
  const shadowBound = Math.max(plan.floor.width, plan.floor.depth) * 0.75;
  sun.shadow.camera.left = -shadowBound;
  sun.shadow.camera.right = shadowBound;
  sun.shadow.camera.top = shadowBound;
  sun.shadow.camera.bottom = -shadowBound;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 68;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  worldGroup.add(sun);

  const fill = new THREE.DirectionalLight(isNight ? 0x38bdf8 : 0xe0f2fe, isNight ? 0.44 : 0.35);
  fill.position.set(-14, 10, -10);
  worldGroup.add(fill);

  const { floor, meetingTable } = plan;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(floor.width, 0.46, floor.depth),
    new THREE.MeshStandardMaterial({
      color: isNight ? 0x1e293b : 0xf8fafc,
      roughness: 0.82,
      metalness: 0.04,
    }),
  );
  slab.position.set(floor.centerX, -0.23, floor.centerZ);
  slab.receiveShadow = true;
  worldGroup.add(slab);

  const slabTrim = new THREE.Mesh(
    new THREE.BoxGeometry(floor.width + 0.16, 0.14, floor.depth + 0.16),
    new THREE.MeshStandardMaterial({
      color: isNight ? 0x0f172a : 0xcbd5e1,
      roughness: 0.7,
    }),
  );
  slabTrim.position.set(floor.centerX, -0.4, floor.centerZ);
  worldGroup.add(slabTrim);

  const grid = new THREE.GridHelper(
    Math.max(floor.width, floor.depth),
    Math.round(Math.max(floor.width, floor.depth)),
    isNight ? 0x334155 : 0xcbd5e1,
    isNight ? 0x243044 : 0xe2e8f0,
  );
  grid.position.set(floor.centerX, 0.004, floor.centerZ);
  grid.scale.set(
    floor.width / Math.max(floor.width, floor.depth),
    1,
    floor.depth / Math.max(floor.width, floor.depth),
  );
  worldGroup.add(grid);

  const wallHeight = 3.15;
  const wallThickness = 0.22;
  const wallMat = new THREE.MeshStandardMaterial({
    color: isNight ? 0x172033 : 0xe2e8f0,
    roughness: 0.85,
  });

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(floor.width, wallHeight, wallThickness),
    wallMat,
  );
  backWall.position.set(floor.centerX, wallHeight / 2, floor.minZ + wallThickness / 2);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  worldGroup.add(backWall);

  const sideWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, floor.depth),
    wallMat,
  );
  sideWall.position.set(floor.minX + wallThickness / 2, wallHeight / 2, floor.centerZ);
  sideWall.receiveShadow = true;
  sideWall.castShadow = true;
  worldGroup.add(sideWall);

  const kpiBoardWidth = Math.min(5.6, Math.max(4.1, floor.width - 5.6));
  const kpiBuilt = buildKpiWallGroup(
    floor.centerX,
    floor.minZ + wallThickness + 0.04,
    kpiBoardWidth,
    kpi,
  );
  worldGroup.add(kpiBuilt.group);
  pickables.push(kpiBuilt.group);

  const windowCount = Math.max(2, Math.floor((floor.width - 3) / 3.4));
  const windowGlassMat = new THREE.MeshBasicMaterial({
    color: isNight ? 0x1e3a8a : 0xbae6fd,
    transparent: true,
    opacity: isNight ? 0.68 : 0.82,
  });
  for (let idx = 0; idx < windowCount; idx++) {
    const wx = floor.centerX + (idx - (windowCount - 1) / 2) * 3.35;
    if (Math.abs(wx - floor.centerX) < kpiBoardWidth * 0.5 + 1.25) continue;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.45), windowGlassMat);
    pane.position.set(wx, 1.62, floor.minZ + wallThickness + 0.02);
    worldGroup.add(pane);
  }

  worldGroup.add(buildCoffeeBar(floor.maxX - 2.35, floor.minZ + 0.72));
  if (plan.desks.length > 0) {
    const loungeGroup = buildDiscussionLounge(meetingTable.x, meetingTable.z, isNight);
    worldGroup.add(loungeGroup);
    if (plan.desks.length >= 2) {
      pickables.push(loungeGroup);
    }
  }
  worldGroup.add(buildPottedPlant(floor.minX + 0.85, floor.minZ + 0.85, 1.1));
  worldGroup.add(buildPottedPlant(floor.maxX - 0.75, floor.maxZ - 0.75, 1.05));
  worldGroup.add(buildPottedPlant(floor.minX + 0.85, floor.maxZ - 0.8, 0.95));

  for (const zone of plan.zones) {
    const zoneColor = new THREE.Color(zone.accentHex);
    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(zone.width, 0.028, zone.depth),
      new THREE.MeshStandardMaterial({
        color: zoneColor.clone().lerp(new THREE.Color(isNight ? 0x1e293b : 0xf1f5f9), isNight ? 0.82 : 0.86),
        roughness: 0.92,
      }),
    );
    rug.position.set(zone.x, 0.014, zone.z);
    rug.receiveShadow = true;
    rug.userData.zoneKey = zone.key;
    rug.userData.zoneName = zone.name;
    worldGroup.add(rug);
    zoneRugs.push(rug);

    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(zone.width, 0.036, 0.1),
      new THREE.MeshBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.8 }),
    );
    strip.position.set(zone.x, 0.02, zone.z + zone.depth / 2 - 0.05);
    worldGroup.add(strip);

    const glassDivider = new THREE.Mesh(
      new THREE.BoxGeometry(zone.width - 0.6, 1.05, 0.05),
      new THREE.MeshStandardMaterial({
        color: isNight ? 0x64748b : 0xcbd5e1,
        transparent: true,
        opacity: 0.24,
        roughness: 0.2,
        metalness: 0.1,
      }),
    );
    glassDivider.position.set(zone.x, 0.54, zone.z - zone.depth / 2 + 0.06);
    worldGroup.add(glassDivider);
  }

  plan.desks.forEach((desk, deskIndex) => {
    const station = new THREE.Group();
    station.position.set(desk.x, 0, desk.z);
    station.rotation.y = desk.rotationY;
    station.userData.botId = desk.bot.id;
    worldGroup.add(station);
    pickables.push(station);

    const woodColor = desk.role === "chief"
      ? (isNight ? 0x78553a : 0xb4845c)
      : (isNight ? 0x475569 : 0xd6d3d1);
    const tabletop = new THREE.Mesh(
      new THREE.BoxGeometry(1.78, 0.075, 0.88),
      new THREE.MeshStandardMaterial({ color: woodColor, roughness: 0.58 }),
    );
    tabletop.position.set(0, 0.74, 0);
    tabletop.castShadow = true;
    tabletop.receiveShadow = true;
    station.add(tabletop);

    const legMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x0f172a : 0x334155, metalness: 0.5, roughness: 0.45 });
    const legOffsets: Array<[number, number]> = [
      [-0.8, -0.36],
      [0.8, -0.36],
      [-0.8, 0.36],
      [0.8, 0.36],
    ];
    for (const [lx, lz] of legOffsets) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.06), legMat);
      leg.position.set(lx, 0.36, lz);
      leg.castShadow = true;
      station.add(leg);
    }

    const deskMat = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.012, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 }),
    );
    deskMat.position.set(-0.04, 0.784, 0.14);
    station.add(deskMat);

    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.022, 0.16),
      new THREE.MeshStandardMaterial({ color: isNight ? 0xe2e8f0 : 0x334155, roughness: 0.5 }),
    );
    keyboard.position.set(-0.08, 0.798, 0.15);
    station.add(keyboard);

    const mouse = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.022, 0.11),
      new THREE.MeshStandardMaterial({ color: isNight ? 0xe2e8f0 : 0x475569, roughness: 0.45 }),
    );
    mouse.position.set(0.26, 0.798, 0.16);
    station.add(mouse);

    const mugMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(desk.bodyHex), roughness: 0.35 });
    const deskMug = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.11, 10), mugMat);
    deskMug.position.set(-0.62, 0.83, 0.16);
    deskMug.castShadow = true;
    station.add(deskMug);

    const codeSparksGroup = new THREE.Group();
    codeSparksGroup.position.set(-0.04, 0, 0.08);
    codeSparksGroup.visible = false;
    const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(desk.bodyHex) });
    for (let s = 0; s < 3; s++) {
      const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), sparkMat);
      spark.position.set((s - 1) * 0.18, 0.88, 0);
      codeSparksGroup.add(spark);
    }
    station.add(codeSparksGroup);

    const standNeck = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.06), legMat);
    standNeck.position.set(0.04, 0.9, -0.26);
    station.add(standNeck);

    const monitorGroup = new THREE.Group();
    monitorGroup.position.set(0.04, 1.11, -0.22);
    monitorGroup.rotation.x = -0.09;
    station.add(monitorGroup);

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.62, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.3 }),
    );
    bezel.castShadow = true;
    monitorGroup.add(bezel);

    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = 320;
    screenCanvas.height = 192;
    drawProceduralMonitorScreen(screenCanvas, desk.bodyHex, desk.screenState, desk.workAction, 0);

    const screenTexture = new THREE.CanvasTexture(screenCanvas);
    screenTexture.colorSpace = THREE.SRGBColorSpace;

    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.55),
      new THREE.MeshBasicMaterial({ map: screenTexture }),
    );
    screenPlane.position.z = 0.028;
    monitorGroup.add(screenPlane);

    const lampColor = 0xfde68a;
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.03, 10), legMat);
    lampBase.position.set(0.66, 0.79, -0.18);
    station.add(lampBase);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), legMat);
    lampStem.position.set(0.66, 0.96, -0.18);
    station.add(lampStem);
    const lampShadeMat = new THREE.MeshStandardMaterial({
      color: isNight ? 0x334155 : 0x475569,
      emissive: new THREE.Color(lampColor),
      emissiveIntensity: 0.14,
      roughness: 0.5,
    });
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.13, 10), lampShadeMat);
    lampShade.position.set(0.61, 1.12, -0.14);
    lampShade.rotation.z = 0.32;
    station.add(lampShade);

    const lampBulbMat = new THREE.MeshStandardMaterial({
      color: lampColor,
      emissive: new THREE.Color(lampColor),
      emissiveIntensity: 0.65,
    });
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 10), lampBulbMat);
    lampBulb.position.set(0.59, 1.06, -0.14);
    station.add(lampBulb);

    const chairGroup = new THREE.Group();
    chairGroup.position.set(-0.08, 0, 0.56);
    chairGroup.userData.dragBotId = desk.bot.id;
    station.add(chairGroup);

    const chairMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x1e293b : 0x334155, roughness: 0.72 });
    const chairPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), legMat);
    chairPedestal.position.y = 0.2;
    chairGroup.add(chairPedestal);
    const chairBase = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.035, 10), legMat);
    chairBase.position.y = 0.02;
    chairGroup.add(chairBase);
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.46), chairMat);
    chairSeat.position.y = 0.42;
    chairSeat.castShadow = true;
    chairGroup.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.06), chairMat);
    chairBack.position.set(0, 0.62, 0.21);
    chairBack.castShadow = true;
    chairGroup.add(chairBack);

    const seatWorld = localToWorldPoint(desk.x, desk.z, desk.rotationY, -0.08, 0.53);
    const seatRotY = desk.rotationY + Math.PI;

    const botRoot = new THREE.Group();
    botRoot.position.set(seatWorld.x, 0.44, seatWorld.z);
    botRoot.rotation.y = seatRotY;
    botRoot.userData.botId = desk.bot.id;
    botRoot.userData.dragBotId = desk.bot.id;
    worldGroup.add(botRoot);
    pickables.push(botRoot);

    const dragHitVolume = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 1.32, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    dragHitVolume.position.set(0, 0.4, 0);
    dragHitVolume.userData.botId = desk.bot.id;
    dragHitVolume.userData.dragBotId = desk.bot.id;
    botRoot.add(dragHitVolume);

    const bodyGroup = new THREE.Group();
    botRoot.add(bodyGroup);

    const botColor = new THREE.Color(desk.bodyHex);
    const botMat = new THREE.MeshStandardMaterial({
      color: botColor,
      roughness: 0.36,
      metalness: desk.bot.color === "chrome" || desk.bot.color === "silver" ? 0.55 : 0.08,
    });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55 });

    const buildLeg = (side: -1 | 1) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.095, 0.06, 0);
      const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 6, 10), botMat);
      legMesh.position.set(0, -0.14, 0);
      legMesh.castShadow = true;
      hip.add(legMesh);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.065, 0.16), shoeMat);
      shoe.position.set(0, -0.26, 0.03);
      shoe.castShadow = true;
      hip.add(shoe);
      return hip;
    };
    const leftLeg = buildLeg(-1);
    const rightLeg = buildLeg(1);
    botRoot.add(leftLeg, rightLeg);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.22, 8, 14), botMat);
    torso.position.y = 0.24;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.58, 0);
    bodyGroup.add(headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 14), botMat);
    head.scale.set(1.06, 0.96, 1);
    head.castShadow = true;
    headGroup.add(head);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.14, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.3 }),
    );
    visor.position.set(0, 0.01, 0.175);
    headGroup.add(visor);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.058, 0.02), eyeMat);
    leftEye.position.set(-0.062, 0.012, 0.218);
    headGroup.add(leftEye);
    const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.058, 0.02), eyeMat);
    rightEye.position.set(0.062, 0.012, 0.218);
    headGroup.add(rightEye);

    if (desk.role === "chief") {
      const crownMat = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: new THREE.Color(0xd97706),
        emissiveIntensity: 0.25,
        metalness: 0.65,
        roughness: 0.28,
      });
      const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.09, 6), crownMat);
      crownBand.position.y = 0.235;
      headGroup.add(crownBand);
    } else {
      const earCupMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 });
      const leftEar = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.045, 10), earCupMat);
      leftEar.rotation.z = Math.PI / 2;
      leftEar.position.set(-0.225, 0.01, 0);
      headGroup.add(leftEar);
      const rightEar = leftEar.clone();
      rightEar.position.x = 0.225;
      headGroup.add(rightEar);
    }

    const thoughtGroup = new THREE.Group();
    thoughtGroup.position.set(0, 0.96, 0);
    thoughtGroup.visible = false;
    const thoughtMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    for (let orbIdx = 0; orbIdx < 3; orbIdx++) {
      const angle = (orbIdx / 3) * Math.PI * 2;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 10), thoughtMat);
      orb.position.set(Math.cos(angle) * 0.18, (orbIdx % 2) * 0.04, Math.sin(angle) * 0.18);
      thoughtGroup.add(orb);
    }
    bodyGroup.add(thoughtGroup);

    const buildArm = (side: -1 | 1) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.23, 0.34, 0.02);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 6, 10), botMat);
      limb.position.set(0, -0.14, 0);
      limb.castShadow = true;
      pivot.add(limb);
      return pivot;
    };
    const leftArm = buildArm(-1);
    const rightArm = buildArm(1);
    bodyGroup.add(leftArm, rightArm);

    const tabletProp = new THREE.Group();
    tabletProp.position.set(0.06, -0.26, 0.12);
    tabletProp.rotation.set(0.75, -0.25, 0);
    tabletProp.visible = false;
    const tabletBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.31, 0.022),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35 }),
    );
    const tabletScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.27),
      new THREE.MeshBasicMaterial({ color: 0xbae6fd }),
    );
    tabletScreen.position.z = 0.013;
    tabletProp.add(tabletBody, tabletScreen);
    leftArm.add(tabletProp);

    const heldMug = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.042, 0.1, 10), mugMat);
    heldMug.position.set(-0.03, -0.25, 0.08);
    heldMug.rotation.x = Math.PI / 2;
    heldMug.visible = false;
    rightArm.add(heldMug);

    const statusRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const statusRing = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 28), statusRingMat);
    statusRing.rotation.x = -Math.PI / 2;
    statusRing.position.set(seatWorld.x, 0.032, seatWorld.z);
    statusRing.visible = false;
    worldGroup.add(statusRing);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 36),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.set(seatWorld.x, 0.034, seatWorld.z);
    selectionRing.visible = selectedBotId === desk.bot.id;
    worldGroup.add(selectionRing);

    rigs.push({
      botId: desk.bot.id,
      deskX: desk.x,
      deskZ: desk.z,
      deskRotationY: desk.rotationY,
      seatWorldX: seatWorld.x,
      seatWorldZ: seatWorld.z,
      seatRotationY: seatRotY,
      stepOutPoint: desk.stepOutPoint,
      bodyHex: desk.bodyHex,
      botRoot,
      bodyGroup,
      headGroup,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      leftEye,
      rightEye,
      eyeMat,
      chairGroup,
      deskMug,
      heldMug,
      tabletProp,
      thoughtGroup,
      codeSparksGroup,
      lampBulbMat,
      lampShadeMat,
      statusRing,
      statusRingMat,
      selectionRing,
      screenCanvas,
      screenTexture,
      hasLiveFrame: false,
      phaseOffset: deskIndex * 1.93,
      mode: "seated",
      activeConversationId: null,
      route: [],
      routeIndex: 0,
      currentX: seatWorld.x,
      currentZ: seatWorld.z,
      currentY: 0.44,
      currentRotY: seatRotY,
      seatBlend: 1,
      walkDistance: 0,
    });
  });

  return {
    rigs,
    pickables,
    zoneRugs,
    kpiWall: kpiBuilt.rig,
  };
}

export function rebuildDynamicConnectionsGroup<T extends OfficeBotInput>(
  dynamicGroup: THREE.Group,
  plan: OfficePlan<T>,
): {
  packets: AnimatedHandoffPacket[];
  convRings: AnimatedConversationRing[];
} {
  disposeSceneResources(dynamicGroup);
  dynamicGroup.clear();
  const packets: AnimatedHandoffPacket[] = [];
  const convRings: AnimatedConversationRing[] = [];

  plan.conversations.forEach((conv, idx) => {
    const radius = conv.kind === "lounge-meeting" ? 1.55 : 0.78;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.1, radius, 36), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(conv.center.x, 0.028, conv.center.z);
    dynamicGroup.add(ring);
    convRings.push({ ring, mat: ringMat, phase: idx * 1.2 });
  });

  plan.handoffs.forEach((handoff, index) => {
    const start = new THREE.Vector3(handoff.from.x, handoff.from.y, handoff.from.z);
    const end = new THREE.Vector3(handoff.to.x, handoff.to.y, handoff.to.z);
    const distance = start.distanceTo(end);
    const mid = start.clone().lerp(end, 0.5);
    mid.y += Math.min(2.6, Math.max(1.05, distance * 0.28));

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const points = curve.getPoints(32);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineColor = handoff.state === "running" ? 0x10b981 : handoff.state === "queued" ? 0xf59e0b : 0x64748b;
    const lineMat = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: handoff.state === "connected" ? 0.26 : 0.72,
    });
    dynamicGroup.add(new THREE.Line(lineGeo, lineMat));

    if (handoff.state === "running" || handoff.state === "queued") {
      const packetMat = new THREE.MeshBasicMaterial({ color: lineColor });
      for (let copy = 0; copy < 2; copy++) {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.072, 10, 10), packetMat);
        dynamicGroup.add(orb);
        packets.push({
          curve,
          mesh: orb,
          speed: handoff.state === "running" ? 0.55 : 0.28,
          offset: (index * 0.23 + copy * 0.5) % 1,
        });
      }
    }
  });

  return { packets, convRings };
}
