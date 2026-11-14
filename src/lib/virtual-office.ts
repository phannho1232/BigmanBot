import { MAUS_COLORS, type MausColor } from "./mascot";
import type { TeamMapBot, TeamMapEdge, TeamMapSection } from "./team-map";
import type { MapComputer } from "../../shared/map-computer";
import type { TurnProgressActivity } from "../../shared/turn-progress";

export interface OfficePoint3D {
  x: number;
  y: number;
  z: number;
}

export interface OfficePoint2D {
  x: number;
  z: number;
}

export interface OfficeCameraPose {
  position: OfficePoint3D;
  target: OfficePoint3D;
}

export type OfficeBotPosture = "typing" | "talking" | "waiting" | "offline" | "idle";

export type OfficeWorkAction =
  | "coding"
  | "terminal"
  | "researching"
  | "thinking"
  | "replying"
  | "screen"
  | "talking"
  | "waiting"
  | "offline"
  | "idle";

export type OfficeScreenState = "working" | "starting" | "idle" | "off";

export type LiveWorkKind = TurnProgressActivity | "thinking" | "reply" | "screen";

export interface OfficeBotInput extends TeamMapBot {
  color?: MausColor;
  title?: string;
}

export interface OfficeConversationInput {
  id: string;
  kind: "desk-visit" | "lounge-meeting";
  initiatorBotId: string;
  participantBotIds: string[];
  speakerBotId?: string;
  topic?: string;
  dialogueByBotId?: Readonly<Record<string, string>>;
}

export interface OfficeParticipantAssignment {
  botId: string;
  conversationId: string;
  role: "visitor" | "host" | "member";
  isSpeaker: boolean;
  standPoint: OfficePoint2D;
  faceAngleY: number;
  waypoints: OfficePoint2D[];
  partnerBotId?: string;
  dialogueText?: string;
}

export interface OfficeConversationPlacement {
  id: string;
  kind: "desk-visit" | "lounge-meeting";
  center: OfficePoint2D;
  participantBotIds: string[];
  speakerBotId: string;
  topic?: string;
}

export interface OfficeDesk<T extends OfficeBotInput = OfficeBotInput> {
  bot: T;
  sectionKey: string;
  sectionName: string;
  role: "chief" | "member";
  x: number;
  z: number;
  rotationY: number;
  stepOutPoint: OfficePoint2D;
  bodyHex: string;
  posture: OfficeBotPosture;
  workAction: OfficeWorkAction;
  activityText?: string;
  computerId?: string;
  screenFrameUrl?: string;
  screenState: OfficeScreenState;
  conversation?: OfficeParticipantAssignment;
}

export interface OfficeZone<T extends OfficeBotInput = OfficeBotInput> {
  key: string;
  name: string;
  accentHex: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  desks: OfficeDesk<T>[];
}

export interface OfficeHandoff {
  sourceBotId: string;
  targetBotId: string;
  from: OfficePoint3D;
  to: OfficePoint3D;
  state: TeamMapEdge["state"];
  reason?: string;
}

export interface OfficeFloorBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
}

export interface OfficePlan<T extends OfficeBotInput = OfficeBotInput> {
  layoutKey: string;
  zones: OfficeZone<T>[];
  desks: OfficeDesk<T>[];
  handoffs: OfficeHandoff[];
  conversations: OfficeConversationPlacement[];
  meetingTable: OfficePoint2D;
  floor: OfficeFloorBounds;
  overviewCamera: OfficeCameraPose;
}

export interface BuildOfficePlanOptions {
  edges?: readonly TeamMapEdge[];
  computers?: readonly MapComputer[];
  frameUrls?: Readonly<Record<string, string>>;
  activities?: Readonly<Record<string, string | undefined>>;
  workKinds?: Readonly<Record<string, LiveWorkKind | undefined>>;
  conversations?: readonly OfficeConversationInput[];
  startingBotIds?: Readonly<Record<string, unknown>>;
}

export interface ConversationGroupSignal {
  id: string;
  name: string;
  dm?: boolean;
  memberIds: readonly string[];
  working?: boolean;
  busyBotId?: string | null;
  messages?: ReadonlyArray<{
    at: number;
    kind: string;
    text?: string;
    from?: { botId: string; name: string };
  }>;
  tasks?: ReadonlyArray<{
    working?: boolean;
    busyBotId?: string | null;
  }>;
}

export interface ConversationBotSignal {
  id: string;
  name: string;
  busy?: boolean;
  waitingForTeammates?: boolean;
  tasks?: ReadonlyArray<{
    title: string;
    busy?: boolean;
    waitingForTeammates?: boolean;
    askedBy?: { botId?: string; name?: string } | null;
    openAsks?: number;
  }>;
  messages?: ReadonlyArray<{
    at: number;
    kind: string;
    text?: string;
    comm?: { withBotId: string; withName: string };
    peerAsk?: { botId: string; name: string };
  }>;
}

const ZONE_ACCENTS = [
  "#377FE6",
  "#009957",
  "#8057C8",
  "#E78531",
  "#01A492",
  "#D84F8B",
  "#0EA5C6",
  "#D8A729",
] as const;

const DESK_SPACING_X = 3.4;
const DESK_SPACING_Z = 3.15;
const ZONE_PADDING_X = 1.75;
const ZONE_PADDING_Z = 1.75;
const ZONE_GAP_X = 2.3;
const ZONE_GAP_Z = 2.35;
const FLOOR_MARGIN = 2.65;
const LOUNGE_EXTRA_DEPTH = 2.55;
export const CONVERSATION_HOLD_MS = 22_000;

export function resolveBotBodyHex(color: MausColor | undefined): string {
  if (!color) return MAUS_COLORS.green;
  return MAUS_COLORS[color] ?? MAUS_COLORS.green;
}

export function resolveBotWorkAction(
  bot: TeamMapBot,
  liveKind?: LiveWorkKind,
  hasConversation = false,
): OfficeWorkAction {
  if (bot.activity === "dead" || bot.activity === "no-signal") return "offline";
  if (hasConversation) return "talking";
  if (bot.activity === "waiting-on-you") return "waiting";
  if (bot.busy || bot.activity === "working") {
    switch (liveKind) {
      case "command":
        return "terminal";
      case "read":
      case "search":
      case "web":
      case "fetch":
        return "researching";
      case "thinking":
        return "thinking";
      case "reply":
        return "replying";
      case "screen":
        return "screen";
      case "write":
      case "edit":
      case "tool":
      default:
        return "coding";
    }
  }
  return "idle";
}

export function resolveBotPosture(bot: TeamMapBot, hasConversation = false): OfficeBotPosture {
  const action = resolveBotWorkAction(bot, undefined, hasConversation);
  if (action === "offline") return "offline";
  if (action === "talking") return "talking";
  if (action === "waiting") return "waiting";
  if (action === "idle") return "idle";
  return "typing";
}

function trimSnippet(raw: string | undefined, limit = 62): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

export function detectOfficeConversations(options: {
  bots: readonly ConversationBotSignal[];
  edges: readonly TeamMapEdge[];
  groups: readonly ConversationGroupSignal[];
  now?: number;
  holdMs?: number;
}): OfficeConversationInput[] {
  const { bots, edges, groups, now = Date.now(), holdMs = CONVERSATION_HOLD_MS } = options;
  const visibleIds = new Set(bots.map((bot) => bot.id));
  const claimed = new Set<string>();
  const results: OfficeConversationInput[] = [];

  const claimAll = (ids: readonly string[]): boolean => {
    const valid = [...new Set(ids)].filter((id) => visibleIds.has(id));
    if (valid.length < 2 || valid.some((id) => claimed.has(id))) return false;
    for (const id of valid) claimed.add(id);
    return true;
  };

  for (const edge of edges) {
    if (edge.state !== "running" && edge.state !== "queued") continue;
    const pair = [edge.sourceBotId, edge.targetBotId];
    if (!claimAll(pair)) continue;
    results.push({
      id: `handoff:${edge.sourceBotId}:${edge.targetBotId}`,
      kind: "desk-visit",
      initiatorBotId: edge.sourceBotId,
      participantBotIds: pair,
      speakerBotId: edge.state === "running" ? edge.targetBotId : edge.sourceBotId,
      topic: trimSnippet(edge.reason),
    });
  }

  for (const group of groups) {
    const members = group.memberIds.filter((id) => visibleIds.has(id));
    if (members.length < 2) continue;
    const activeTask = group.tasks?.find((task) => task.working || task.busyBotId);
    const recentMessages = (group.messages ?? []).filter((msg) => now - msg.at <= holdMs);
    const lastBotMsg = [...(group.messages ?? [])].reverse().find((msg) => msg.from?.botId && visibleIds.has(msg.from.botId));
    const isWorking = group.working === true || Boolean(group.busyBotId) || Boolean(activeTask);
    const isRecent = recentMessages.length > 0;
    if (!isWorking && !isRecent) continue;

    const participants = members.slice(0, 10);
    if (!claimAll(participants)) continue;

    const speaker = (group.busyBotId && visibleIds.has(group.busyBotId) ? group.busyBotId : undefined)
      ?? (activeTask?.busyBotId && visibleIds.has(activeTask.busyBotId) ? activeTask.busyBotId : undefined)
      ?? lastBotMsg?.from?.botId
      ?? participants[0]!;

    const dialogueByBotId: Record<string, string> = {};
    for (const msg of recentMessages) {
      const authorId = msg.from?.botId;
      const snippet = trimSnippet(msg.text);
      if (authorId && snippet) dialogueByBotId[authorId] = snippet;
    }

    results.push({
      id: `group:${group.id}`,
      kind: participants.length === 2 ? "desk-visit" : "lounge-meeting",
      initiatorBotId: participants.length === 2 ? participants[0]! : speaker,
      participantBotIds: participants,
      speakerBotId: speaker,
      topic: trimSnippet(lastBotMsg?.text) ?? trimSnippet(group.name),
      dialogueByBotId,
    });
  }

  for (const bot of bots) {
    const recentPeerMsg = [...(bot.messages ?? [])]
      .reverse()
      .find((msg) => now - msg.at <= holdMs && (msg.comm?.withBotId || msg.peerAsk?.botId));
    const partnerId = recentPeerMsg?.comm?.withBotId
      ?? recentPeerMsg?.peerAsk?.botId
      ?? bot.tasks?.find((task) => task.busy && task.askedBy?.botId)?.askedBy?.botId;
    if (!partnerId || partnerId === bot.id) continue;
    const pair = [bot.id, partnerId];
    if (!claimAll(pair)) continue;
    results.push({
      id: `peer:${bot.id}:${partnerId}`,
      kind: "desk-visit",
      initiatorBotId: bot.id,
      participantBotIds: pair,
      speakerBotId: bot.busy ? bot.id : partnerId,
      topic: trimSnippet(recentPeerMsg?.text),
    });
  }

  for (const edge of edges) {
    if (edge.state !== "connected" || !edge.lastAt || now - edge.lastAt > holdMs) continue;
    const pair = [edge.sourceBotId, edge.targetBotId];
    if (!claimAll(pair)) continue;
    results.push({
      id: `recent:${edge.sourceBotId}:${edge.targetBotId}`,
      kind: "desk-visit",
      initiatorBotId: edge.sourceBotId,
      participantBotIds: pair,
      speakerBotId: edge.sourceBotId,
      topic: trimSnippet(edge.reason),
    });
  }

  return results;
}

function localToWorld(originX: number, originZ: number, rotationY: number, lx: number, lz: number): OfficePoint2D {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    x: originX + lx * cos + lz * sin,
    z: originZ - lx * sin + lz * cos,
  };
}

interface ObstacleCircle {
  x: number;
  z: number;
  radius: number;
  ownerBotId?: string;
}

function segmentHitsCircle(
  a: OfficePoint2D,
  b: OfficePoint2D,
  circle: ObstacleCircle,
): { t: number; closestX: number; closestZ: number; dist: number } | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-5) return null;
  const t = Math.max(0.05, Math.min(0.95, ((circle.x - a.x) * dx + (circle.z - a.z) * dz) / lenSq));
  const closestX = a.x + dx * t;
  const closestZ = a.z + dz * t;
  const dist = Math.hypot(closestX - circle.x, closestZ - circle.z);
  if (dist >= circle.radius) return null;
  return { t, closestX, closestZ, dist };
}

export function buildWalkWaypoints(
  start: OfficePoint2D,
  goal: OfficePoint2D,
  obstacles: readonly ObstacleCircle[],
  movingBotId?: string,
): OfficePoint2D[] {
  const distTotal = Math.hypot(goal.x - start.x, goal.z - start.z);
  if (distTotal < 0.08) return [{ ...goal }];

  let path: OfficePoint2D[] = [{ ...start }, { ...goal }];
  for (let pass = 0; pass < 3; pass++) {
    const nextPath: OfficePoint2D[] = [path[0]!];
    let splitOccurred = false;

    for (let idx = 0; idx < path.length - 1; idx++) {
      const a = path[idx]!;
      const b = path[idx + 1]!;
      let blocking: { circle: ObstacleCircle; hit: NonNullable<ReturnType<typeof segmentHitsCircle>> } | null = null;

      for (const circle of obstacles) {
        if (movingBotId && circle.ownerBotId === movingBotId) continue;
        if (Math.hypot(a.x - circle.x, a.z - circle.z) < circle.radius * 0.92) continue;
        if (Math.hypot(b.x - circle.x, b.z - circle.z) < circle.radius * 0.92) continue;
        const hit = segmentHitsCircle(a, b, circle);
        if (hit && (!blocking || hit.t < blocking.hit.t)) {
          blocking = { circle, hit };
        }
      }

      if (blocking) {
        const { circle, hit } = blocking;
        const segDx = b.x - a.x;
        const segDz = b.z - a.z;
        const segLen = Math.max(1e-4, Math.hypot(segDx, segDz));
        const nx = -segDz / segLen;
        const nz = segDx / segLen;
        const clearance = circle.radius + 0.34;
        const candidateA = { x: circle.x + nx * clearance, z: circle.z + nz * clearance };
        const candidateB = { x: circle.x - nx * clearance, z: circle.z - nz * clearance };
        const score = (pt: OfficePoint2D) =>
          Math.hypot(pt.x - a.x, pt.z - a.z) + Math.hypot(b.x - pt.x, b.z - pt.z)
          + (Math.hypot(pt.x - hit.closestX, pt.z - hit.closestZ) * 0.15);
        nextPath.push(score(candidateA) <= score(candidateB) ? candidateA : candidateB);
        splitOccurred = true;
      }

      nextPath.push(b);
    }

    path = nextPath;
    if (!splitOccurred) break;
  }

  return path.slice(1);
}

function findBotComputer(computers: readonly MapComputer[], botId: string): MapComputer | undefined {
  return computers.find((item) => item.kind === "bot" && item.id === botId)
    ?? computers.find((item) => item.kind === "team" && item.botIds.includes(botId));
}

function resolveScreenState(
  bot: TeamMapBot,
  computer: MapComputer | undefined,
  starting: boolean,
): OfficeScreenState {
  if (starting || computer?.state === "starting") return "starting";
  if (bot.busy || bot.activity === "working" || computer?.state === "working") return "working";
  if (!computer) return bot.activity === "dead" || bot.activity === "no-signal" ? "off" : "idle";
  if (computer.state === "idle") return "idle";
  return "off";
}

interface LocalZoneSpec<T extends OfficeBotInput> {
  section: TeamMapSection<T>;
  accentHex: string;
  width: number;
  depth: number;
  localDesks: Array<{ bot: T; role: "chief" | "member"; lx: number; lz: number; rotationY: number }>;
}

function measureZone<T extends OfficeBotInput>(section: TeamMapSection<T>, index: number): LocalZoneSpec<T> {
  const leadColor = section.chiefs[0]?.color ?? section.members[0]?.color;
  const accentHex = leadColor && leadColor !== "chrome" && leadColor !== "silver"
    ? resolveBotBodyHex(leadColor)
    : ZONE_ACCENTS[index % ZONE_ACCENTS.length]!;

  const chiefs = section.chiefs;
  const members = section.members;
  const total = chiefs.length + members.length;

  if (total === 0) {
    return {
      section,
      accentHex,
      width: DESK_SPACING_X + ZONE_PADDING_X * 2,
      depth: DESK_SPACING_Z + ZONE_PADDING_Z * 2,
      localDesks: [],
    };
  }

  const memberCols = members.length <= 1 ? 1 : members.length <= 4 ? 2 : 3;
  const chiefCols = Math.min(Math.max(1, chiefs.length), 2);
  const maxCols = Math.max(chiefs.length > 0 ? chiefCols : 1, members.length > 0 ? memberCols : 1);
  const chiefRows = chiefs.length > 0 ? Math.ceil(chiefs.length / chiefCols) : 0;
  const memberRows = members.length > 0 ? Math.ceil(members.length / memberCols) : 0;
  const totalRows = chiefRows + memberRows;

  const width = (maxCols - 1) * DESK_SPACING_X + ZONE_PADDING_X * 2 + 1.9;
  const depth = (totalRows - 1) * DESK_SPACING_Z + ZONE_PADDING_Z * 2 + (chiefRows > 0 && memberRows > 0 ? 2.05 : 1.6);

  const localDesks: LocalZoneSpec<T>["localDesks"] = [];
  const topZ = -depth / 2 + ZONE_PADDING_Z + 0.65;

  chiefs.forEach((bot, chiefIndex) => {
    const row = Math.floor(chiefIndex / chiefCols);
    const col = chiefIndex % chiefCols;
    const colsInRow = Math.min(chiefCols, chiefs.length - row * chiefCols);
    const lx = (col - (colsInRow - 1) / 2) * DESK_SPACING_X;
    const lz = topZ + row * DESK_SPACING_Z;
    localDesks.push({ bot, role: "chief", lx, lz, rotationY: 0.18 });
  });

  const memberStartZ = topZ + chiefRows * DESK_SPACING_Z + (chiefRows > 0 ? 0.48 : 0);
  members.forEach((bot, memberIndex) => {
    const row = Math.floor(memberIndex / memberCols);
    const col = memberIndex % memberCols;
    const colsInRow = Math.min(memberCols, members.length - row * memberCols);
    const lx = (col - (colsInRow - 1) / 2) * DESK_SPACING_X;
    const lz = memberStartZ + row * DESK_SPACING_Z;
    const angle = colsInRow === 1 ? 0.16 : col === 0 ? 0.22 : col === colsInRow - 1 ? -0.14 : 0.08;
    localDesks.push({ bot, role: "member", lx, lz, rotationY: angle });
  });

  return { section, accentHex, width, depth, localDesks };
}

export function buildOfficePlan<T extends OfficeBotInput>(
  sections: readonly TeamMapSection<T>[],
  options: BuildOfficePlanOptions = {},
): OfficePlan<T> {
  const {
    edges = [],
    computers = [],
    frameUrls = {},
    activities = {},
    workKinds = {},
    conversations: inputConversations = [],
    startingBotIds = {},
  } = options;
  const specs = sections.map((section, index) => measureZone(section, index));

  if (specs.length === 0) {
    const floor: OfficeFloorBounds = {
      minX: -6,
      maxX: 6,
      minZ: -5,
      maxZ: 6,
      width: 12,
      depth: 11,
      centerX: 0,
      centerZ: 0.5,
    };
    return {
      layoutKey: "empty",
      zones: [],
      desks: [],
      handoffs: [],
      conversations: [],
      meetingTable: { x: 0, z: 3.2 },
      floor,
      overviewCamera: overviewCameraForFloor(floor),
    };
  }

  const zoneColumns = specs.length === 1 ? 1 : specs.length <= 4 ? 2 : 3;
  const rows: Array<LocalZoneSpec<T>[]> = [];
  for (let index = 0; index < specs.length; index += zoneColumns) {
    rows.push(specs.slice(index, index + zoneColumns));
  }

  const rowDepths = rows.map((row) => Math.max(...row.map((item) => item.depth)));
  const totalDepth = rowDepths.reduce((sum, d) => sum + d, 0) + Math.max(0, rows.length - 1) * ZONE_GAP_Z;

  const zones: OfficeZone<T>[] = [];
  const desks: OfficeDesk<T>[] = [];
  const deskByBotId = new Map<string, OfficeDesk<T>>();

  let cursorZ = -totalDepth / 2;
  rows.forEach((row, rowIndex) => {
    const rowDepth = rowDepths[rowIndex]!;
    const rowWidth = row.reduce((sum, item) => sum + item.width, 0) + Math.max(0, row.length - 1) * ZONE_GAP_X;
    let cursorX = -rowWidth / 2;
    const zoneCenterZ = cursorZ + rowDepth / 2;

    for (const spec of row) {
      const zoneCenterX = cursorX + spec.width / 2;
      const zoneDesks: OfficeDesk<T>[] = spec.localDesks.map((entry) => {
        const computer = findBotComputer(computers, entry.bot.id);
        const computerId = computer?.id;
        const screenFrameUrl = computerId && Object.hasOwn(frameUrls, computerId) ? frameUrls[computerId] : undefined;
        const starting = Boolean(Object.hasOwn(startingBotIds, entry.bot.id) && startingBotIds[entry.bot.id]);
        const worldX = zoneCenterX + entry.lx;
        const worldZ = zoneCenterZ + entry.lz;
        const stepOutPoint = localToWorld(worldX, worldZ, entry.rotationY, 0.44, 0.92);
        const liveKind = Object.hasOwn(workKinds, entry.bot.id) ? workKinds[entry.bot.id] : undefined;
        const effectiveKind: LiveWorkKind | undefined = liveKind ?? (screenFrameUrl && entry.bot.busy ? "screen" : undefined);

        const desk: OfficeDesk<T> = {
          bot: entry.bot,
          sectionKey: spec.section.key,
          sectionName: spec.section.name,
          role: entry.role,
          x: worldX,
          z: worldZ,
          rotationY: entry.rotationY,
          stepOutPoint,
          bodyHex: resolveBotBodyHex(entry.bot.color),
          posture: resolveBotPosture(entry.bot, false),
          workAction: resolveBotWorkAction(entry.bot, effectiveKind, false),
          activityText: Object.hasOwn(activities, entry.bot.id) ? activities[entry.bot.id] : undefined,
          computerId,
          screenFrameUrl,
          screenState: resolveScreenState(entry.bot, computer, starting),
        };
        deskByBotId.set(entry.bot.id, desk);
        desks.push(desk);
        return desk;
      });

      zones.push({
        key: spec.section.key,
        name: spec.section.name,
        accentHex: spec.accentHex,
        x: zoneCenterX,
        z: zoneCenterZ,
        width: spec.width,
        depth: spec.depth,
        desks: zoneDesks,
      });
      cursorX += spec.width + ZONE_GAP_X;
    }

    cursorZ += rowDepth + ZONE_GAP_Z;
  });

  const minZoneX = Math.min(...zones.map((zone) => zone.x - zone.width / 2));
  const maxZoneX = Math.max(...zones.map((zone) => zone.x + zone.width / 2));
  const minZoneZ = Math.min(...zones.map((zone) => zone.z - zone.depth / 2));
  const maxZoneZ = Math.max(...zones.map((zone) => zone.z + zone.depth / 2));

  const minX = minZoneX - FLOOR_MARGIN;
  const maxX = maxZoneX + FLOOR_MARGIN;
  const minZ = minZoneZ - FLOOR_MARGIN;
  const maxZ = maxZoneZ + FLOOR_MARGIN + LOUNGE_EXTRA_DEPTH;

  const floor: OfficeFloorBounds = {
    minX,
    maxX,
    minZ,
    maxZ,
    width: Math.max(12, maxX - minX),
    depth: Math.max(11, maxZ - minZ),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };

  const meetingTable: OfficePoint2D = {
    x: floor.centerX,
    z: maxZoneZ + 1.85,
  };

  const obstacles: ObstacleCircle[] = [
    ...desks.map((desk) => ({
      x: desk.x,
      z: desk.z + 0.1,
      radius: 1.02,
      ownerBotId: desk.bot.id,
    })),
    { x: meetingTable.x, z: meetingTable.z, radius: 0.92 },
  ];

  const conversations: OfficeConversationPlacement[] = [];
  const usedBots = new Set<string>();

  for (const conv of inputConversations) {
    const validParticipants = [...new Set(conv.participantBotIds)].filter(
      (id) => deskByBotId.has(id) && !usedBots.has(id) && deskByBotId.get(id)!.posture !== "offline",
    );
    if (validParticipants.length < 2) continue;
    for (const id of validParticipants) usedBots.add(id);

    const speakerId = conv.speakerBotId && validParticipants.includes(conv.speakerBotId)
      ? conv.speakerBotId
      : validParticipants[0]!;

    if (conv.kind === "desk-visit" && validParticipants.length === 2) {
      const visitorId = validParticipants.includes(conv.initiatorBotId) ? conv.initiatorBotId : validParticipants[0]!;
      const hostId = validParticipants.find((id) => id !== visitorId)!;
      const visitorDesk = deskByBotId.get(visitorId)!;
      const hostDesk = deskByBotId.get(hostId)!;

      const hostStand = localToWorld(hostDesk.x, hostDesk.z, hostDesk.rotationY, 0.28, 0.84);
      const visitorStand = localToWorld(hostDesk.x, hostDesk.z, hostDesk.rotationY, 1.08, 0.84);

      const hostFace = Math.atan2(visitorStand.x - hostStand.x, visitorStand.z - hostStand.z);
      const visitorFace = Math.atan2(hostStand.x - visitorStand.x, hostStand.z - visitorStand.z);

      const visitorWaypoints = [
        visitorDesk.stepOutPoint,
        ...buildWalkWaypoints(visitorDesk.stepOutPoint, visitorStand, obstacles, visitorId),
      ];
      const hostWaypoints = [hostStand];

      visitorDesk.posture = "talking";
      visitorDesk.workAction = "talking";
      visitorDesk.conversation = {
        botId: visitorId,
        conversationId: conv.id,
        role: "visitor",
        isSpeaker: speakerId === visitorId,
        standPoint: visitorStand,
        faceAngleY: visitorFace,
        waypoints: visitorWaypoints,
        partnerBotId: hostId,
        dialogueText: conv.dialogueByBotId?.[visitorId] ?? conv.topic,
      };

      hostDesk.posture = "talking";
      hostDesk.workAction = "talking";
      hostDesk.conversation = {
        botId: hostId,
        conversationId: conv.id,
        role: "host",
        isSpeaker: speakerId === hostId,
        standPoint: hostStand,
        faceAngleY: hostFace,
        waypoints: hostWaypoints,
        partnerBotId: visitorId,
        dialogueText: conv.dialogueByBotId?.[hostId] ?? (speakerId === hostId ? conv.topic : undefined),
      };

      conversations.push({
        id: conv.id,
        kind: "desk-visit",
        center: {
          x: (hostStand.x + visitorStand.x) / 2,
          z: (hostStand.z + visitorStand.z) / 2,
        },
        participantBotIds: [visitorId, hostId],
        speakerBotId: speakerId,
        topic: conv.topic,
      });
    } else {
      const count = validParticipants.length;
      const ringRadius = Math.min(2.15, Math.max(1.26, 0.96 + count * 0.12));
      const arcSpan = count >= 6 ? Math.PI * 1.8 : Math.PI * 1.56;
      const startTheta = -arcSpan / 2;
      validParticipants.forEach((botId, idx) => {
        const desk = deskByBotId.get(botId)!;
        const theta = startTheta + (idx / Math.max(1, count - 1)) * arcSpan;
        const standPoint: OfficePoint2D = {
          x: meetingTable.x + Math.cos(theta) * ringRadius,
          z: meetingTable.z + Math.sin(theta) * ringRadius,
        };
        const faceAngleY = Math.atan2(meetingTable.x - standPoint.x, meetingTable.z - standPoint.z);
        const waypoints = [
          desk.stepOutPoint,
          ...buildWalkWaypoints(desk.stepOutPoint, standPoint, obstacles, botId),
        ];

        desk.posture = "talking";
        desk.workAction = "talking";
        desk.conversation = {
          botId,
          conversationId: conv.id,
          role: "member",
          isSpeaker: speakerId === botId,
          standPoint,
          faceAngleY,
          waypoints,
          dialogueText: conv.dialogueByBotId?.[botId] ?? (speakerId === botId ? conv.topic : undefined),
        };
      });

      conversations.push({
        id: conv.id,
        kind: "lounge-meeting",
        center: meetingTable,
        participantBotIds: validParticipants,
        speakerBotId: speakerId,
        topic: conv.topic,
      });
    }
  }

  const handoffs: OfficeHandoff[] = [];
  for (const edge of edges) {
    const sourceDesk = deskByBotId.get(edge.sourceBotId);
    const targetDesk = deskByBotId.get(edge.targetBotId);
    if (!sourceDesk || !targetDesk) continue;
    handoffs.push({
      sourceBotId: edge.sourceBotId,
      targetBotId: edge.targetBotId,
      from: { x: sourceDesk.x, y: 1.35, z: sourceDesk.z },
      to: { x: targetDesk.x, y: 1.35, z: targetDesk.z },
      state: edge.state,
      reason: edge.reason,
    });
  }

  const layoutKey = [
    ...zones.map((z) => `${z.key}:${z.x.toFixed(2)},${z.z.toFixed(2)},${z.width.toFixed(2)},${z.depth.toFixed(2)},${z.accentHex}`),
    ...desks.map((d) => `${d.bot.id}:${d.role}:${d.bodyHex}:${d.x.toFixed(2)},${d.z.toFixed(2)},${d.rotationY.toFixed(2)}`),
  ].join("|");

  return {
    layoutKey,
    zones,
    desks,
    handoffs,
    conversations,
    meetingTable,
    floor,
    overviewCamera: overviewCameraForFloor(floor),
  };
}

export function overviewCameraForFloor(floor: OfficeFloorBounds): OfficeCameraPose {
  const span = Math.max(floor.width, floor.depth);
  const distance = Math.max(12, span * 0.86);
  return {
    target: { x: floor.centerX, y: 0.55, z: floor.centerZ },
    position: {
      x: floor.centerX + distance * 0.66,
      y: distance * 0.62,
      z: floor.centerZ + distance * 0.72,
    },
  };
}

export function kpiWallCamera(floor: OfficeFloorBounds): OfficeCameraPose {
  return {
    target: { x: floor.centerX, y: 1.72, z: floor.minZ + 0.35 },
    position: {
      x: floor.centerX + 0.65,
      y: 2.55,
      z: floor.minZ + 7.2,
    },
  };
}

export function meetingTableCamera(meetingTable: OfficePoint2D): OfficeCameraPose {
  return {
    target: { x: meetingTable.x, y: 0.88, z: meetingTable.z },
    position: {
      x: meetingTable.x + 3.4,
      y: 4.35,
      z: meetingTable.z + 5.6,
    },
  };
}

export function deskFocusCamera(desk: Pick<OfficeDesk, "x" | "z" | "rotationY" | "conversation">): OfficeCameraPose {
  if (desk.conversation) {
    const { standPoint, faceAngleY } = desk.conversation;
    const viewAngle = faceAngleY + Math.PI + 0.52;
    return {
      target: { x: standPoint.x, y: 0.95, z: standPoint.z },
      position: {
        x: standPoint.x + Math.sin(viewAngle) * 4.5,
        y: 3.25,
        z: standPoint.z + Math.cos(viewAngle) * 4.5,
      },
    };
  }
  const offsetX = Math.sin(desk.rotationY + 0.55) * 4.4;
  const offsetZ = Math.cos(desk.rotationY + 0.55) * 4.4;
  return {
    target: { x: desk.x, y: 0.92, z: desk.z },
    position: {
      x: desk.x + offsetX,
      y: 3.35,
      z: desk.z + offsetZ,
    },
  };
}
