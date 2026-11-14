import { describe, expect, it } from "vitest";

import { buildTeamMapSections } from "./team-map";
import {
  buildOfficePlan,
  deskFocusCamera,
  detectOfficeConversations,
  resolveBotBodyHex,
  resolveBotPosture,
  resolveBotWorkAction,
  type OfficeBotInput,
} from "./virtual-office";
import type { MapComputer } from "../../shared/map-computer";

describe("virtual office spatial plan", () => {
  it("builds a clean default floor and overview camera when there are no bots yet", () => {
    const plan = buildOfficePlan([]);
    expect(plan.zones).toEqual([]);
    expect(plan.desks).toEqual([]);
    expect(plan.handoffs).toEqual([]);
    expect(plan.conversations).toEqual([]);
    expect(plan.floor.width).toBeGreaterThanOrEqual(12);
    expect(plan.overviewCamera.position.y).toBeGreaterThan(4);
  });

  it("places chiefs ahead of members in each department without overlapping desks", () => {
    const bots: OfficeBotInput[] = [
      { id: "chief-eng", name: "Atlas", section: "Engineering", chiefOfStaff: true, color: "blue", busy: true },
      { id: "dev-1", name: "Nova", section: "Engineering", color: "cyan", activity: "idle" },
      { id: "dev-2", name: "Bolt", section: "Engineering", color: "teal", activity: "waiting-on-you" },
      { id: "mkt-1", name: "Luna", section: "Growth", color: "orange", activity: "dead" },
    ];
    const sections = buildTeamMapSections(bots, ["Engineering", "Growth", "Empty Lab"]);
    const computers: MapComputer[] = [
      { id: "chief-eng", kind: "bot", name: "Atlas Desktop", botIds: ["chief-eng"], state: "working" },
      { id: "team-growth", kind: "team", name: "Growth Shared", section: "Growth", botIds: ["Luna", "mkt-1"], state: "idle" },
    ];
    const plan = buildOfficePlan(sections, {
      computers,
      frameUrls: { "chief-eng": "blob:atlas-live", "team-growth": "blob:growth-live" },
      activities: { "chief-eng": "Opening github.com" },
      workKinds: { "chief-eng": "web" },
      edges: [
        { sourceBotId: "chief-eng", targetBotId: "dev-1", state: "running", reason: "Reviewing PR" },
      ],
    });

    expect(plan.zones.map((zone) => zone.name)).toEqual(["Engineering", "Growth", "Empty Lab"]);
    expect(plan.desks).toHaveLength(4);

    const chiefDesk = plan.desks.find((desk) => desk.bot.id === "chief-eng")!;
    const memberDesk = plan.desks.find((desk) => desk.bot.id === "dev-1")!;
    const waitingDesk = plan.desks.find((desk) => desk.bot.id === "dev-2")!;
    const offlineDesk = plan.desks.find((desk) => desk.bot.id === "mkt-1")!;

    expect(chiefDesk.role).toBe("chief");
    expect(chiefDesk.z).toBeLessThan(memberDesk.z);
    expect(chiefDesk.posture).toBe("typing");
    expect(chiefDesk.workAction).toBe("researching");
    expect(chiefDesk.screenFrameUrl).toBe("blob:atlas-live");
    expect(chiefDesk.screenState).toBe("working");
    expect(chiefDesk.activityText).toBe("Opening github.com");

    expect(waitingDesk.posture).toBe("waiting");
    expect(waitingDesk.workAction).toBe("waiting");
    expect(offlineDesk.posture).toBe("offline");
    expect(offlineDesk.workAction).toBe("offline");
    expect(offlineDesk.screenFrameUrl).toBe("blob:growth-live");

    for (let i = 0; i < plan.desks.length; i++) {
      for (let j = i + 1; j < plan.desks.length; j++) {
        const a = plan.desks[i]!;
        const b = plan.desks[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2.2);
      }
    }

    expect(plan.handoffs).toEqual([
      {
        sourceBotId: "chief-eng",
        targetBotId: "dev-1",
        from: { x: chiefDesk.x, y: 1.35, z: chiefDesk.z },
        to: { x: memberDesk.x, y: 1.35, z: memberDesk.z },
        state: "running",
        reason: "Reviewing PR",
      },
    ]);

    const focus = deskFocusCamera(chiefDesk);
    expect(focus.target.x).toBeCloseTo(chiefDesk.x);
    expect(focus.target.z).toBeCloseTo(chiefDesk.z);
    expect(focus.position.y).toBeGreaterThan(focus.target.y);
  });

  it("detects bot-to-bot conversations and routes the initiating bot to walk over to the partner's desk or lounge", () => {
    const now = 100_000;
    const bots: OfficeBotInput[] = [
      { id: "atlas", name: "Atlas", section: "Eng", chiefOfStaff: true, color: "blue", busy: true },
      { id: "nova", name: "Nova", section: "Eng", color: "purple", busy: true },
      { id: "luna", name: "Luna", section: "Growth", color: "coral" },
      { id: "bolt", name: "Bolt", section: "Growth", color: "teal" },
      { id: "echo", name: "Echo", section: "Growth", color: "yellow" },
    ];
    const sections = buildTeamMapSections(bots, ["Eng", "Growth"]);
    const conversations = detectOfficeConversations({
      bots,
      edges: [
        { sourceBotId: "atlas", targetBotId: "nova", state: "running", reason: "Syncing schema" },
      ],
      groups: [
        {
          id: "g-launch",
          name: "Launch room",
          memberIds: ["luna", "bolt", "echo"],
          working: true,
          busyBotId: "luna",
          messages: [{ at: now - 1_500, kind: "text", text: "Let's finalize copy!", from: { botId: "luna", name: "Luna" } }],
        },
      ],
      now,
    });

    expect(conversations).toHaveLength(2);
    expect(conversations[0]).toMatchObject({
      kind: "desk-visit",
      initiatorBotId: "atlas",
      participantBotIds: ["atlas", "nova"],
      speakerBotId: "nova",
    });
    expect(conversations[1]).toMatchObject({
      kind: "lounge-meeting",
      participantBotIds: ["luna", "bolt", "echo"],
      speakerBotId: "luna",
    });

    const plan = buildOfficePlan(sections, { conversations });
    const atlasDesk = plan.desks.find((d) => d.bot.id === "atlas")!;
    const novaDesk = plan.desks.find((d) => d.bot.id === "nova")!;
    const lunaDesk = plan.desks.find((d) => d.bot.id === "luna")!;

    expect(atlasDesk.posture).toBe("talking");
    expect(atlasDesk.workAction).toBe("talking");
    expect(atlasDesk.conversation?.role).toBe("visitor");
    expect(atlasDesk.conversation?.partnerBotId).toBe("nova");
    expect(atlasDesk.conversation!.waypoints.length).toBeGreaterThanOrEqual(2);

    expect(novaDesk.conversation?.role).toBe("host");
    const faceDist = Math.hypot(
      atlasDesk.conversation!.standPoint.x - novaDesk.conversation!.standPoint.x,
      atlasDesk.conversation!.standPoint.z - novaDesk.conversation!.standPoint.z,
    );
    expect(faceDist).toBeGreaterThan(0.6);
    expect(faceDist).toBeLessThan(1.1);

    expect(lunaDesk.conversation?.role).toBe("member");
    const distToTable = Math.hypot(
      lunaDesk.conversation!.standPoint.x - plan.meetingTable.x,
      lunaDesk.conversation!.standPoint.z - plan.meetingTable.z,
    );
    expect(distToTable).toBeGreaterThan(1.0);
    expect(distToTable).toBeLessThan(1.6);
  });

  it("maps bot colors, postures, and granular working actions deterministically", () => {
    expect(resolveBotBodyHex("purple")).toBe("#8057C8");
    expect(resolveBotBodyHex(undefined)).toBe("#009957");
    expect(resolveBotPosture({ id: "a", name: "A", busy: true })).toBe("typing");
    expect(resolveBotPosture({ id: "a", name: "A", busy: true }, true)).toBe("talking");
    expect(resolveBotPosture({ id: "a", name: "A", activity: "waiting-on-you", busy: true })).toBe("waiting");
    expect(resolveBotPosture({ id: "a", name: "A", activity: "no-signal" })).toBe("offline");
    expect(resolveBotPosture({ id: "a", name: "A" })).toBe("idle");

    const busyBot = { id: "a", name: "A", busy: true };
    expect(resolveBotWorkAction(busyBot, "write")).toBe("coding");
    expect(resolveBotWorkAction(busyBot, "command")).toBe("terminal");
    expect(resolveBotWorkAction(busyBot, "read")).toBe("researching");
    expect(resolveBotWorkAction(busyBot, "thinking")).toBe("thinking");
    expect(resolveBotWorkAction(busyBot, "reply")).toBe("replying");
    expect(resolveBotWorkAction(busyBot, "screen")).toBe("screen");
    expect(resolveBotWorkAction(busyBot, "write", true)).toBe("talking");
  });

  it("scales large 66-bot departments into balanced grids instead of narrow corridors", () => {
    const bots: OfficeBotInput[] = Array.from({ length: 66 }, (_, index) => ({
      id: `bot-${index + 1}`,
      name: `Bot ${index + 1}`,
      section: index < 54 ? "" : "Ops",
      chiefOfStaff: index === 0 || index === 54,
      color: "blue",
    }));
    const sections = buildTeamMapSections(bots, ["Ops"]);
    const plan = buildOfficePlan(sections);
    expect(plan.desks).toHaveLength(66);
    const ratio = Math.max(plan.floor.width, plan.floor.depth) / Math.min(plan.floor.width, plan.floor.depth);
    expect(ratio).toBeLessThan(2.1);
  });
});
