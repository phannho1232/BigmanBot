// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { api, BotEditorStore, initialState, reducer, type AppState, type Bot, type Group, type useStore } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: vi.fn().mockResolvedValue({ collaborations: [], queued: [], running: [] }),
  };
});

vi.mock("@/lib/use-owner-or-admin", () => ({
  useOwnerOrAdmin: () => true,
}));

vi.mock("./lazy-screens", () => {
  const noopScreen = () => ({ preload: vi.fn().mockResolvedValue(() => null) });
  return {
    BotSettingsDialog: noopScreen(),
    ComputerPanel: noopScreen(),
    PublishedAppsPage: noopScreen(),
    SettingsModal: noopScreen(),
    TeamMapPage: noopScreen(),
    TriggersPage: noopScreen(),
  };
});

import { VirtualOfficePage } from "./VirtualOfficePage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeBot(overrides: Partial<Bot> & { id: string; name: string }): Bot {
  return {
    color: "blue",
    busy: false,
    unread: false,
    messages: [],
    modelSelection: { instanceId: "claude", model: "sonnet" },
    computer: "auto",
    ...overrides,
  } as Bot;
}

describe("VirtualOfficePage", () => {
  let host: HTMLDivElement;
  let root: Root;
  const dispatch = vi.fn();

  beforeEach(() => {
    setLocale("vi");
    dispatch.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setLocale("en");
  });

  async function mount(stateOverrides: Partial<AppState> = {}) {
    const store = {
      state: { ...initialState, activeView: "virtual-office" as const, ...stateOverrides },
      dispatch,
    } as unknown as ReturnType<typeof useStore>;
    await act(async () => {
      root.render(createElement(BotEditorStore, { value: store, children: createElement(VirtualOfficePage) }));
    });
  }

  it("switches store activeView to virtual-office and closes side panels", () => {
    const open = {
      ...initialState,
      settingsOpen: true,
      computerOpen: true,
      inspectorOpen: true,
      activityOpen: true,
      pluginsOpen: true,
    };
    const next = reducer(open, { type: "showVirtualOffice" });
    expect(next).toMatchObject({
      activeView: "virtual-office",
      settingsOpen: false,
      computerOpen: false,
      inspectorOpen: false,
      activityOpen: false,
      pluginsOpen: false,
    });
  });

  it("renders Vietnamese title, empty prompt when no bots exist, and dispatches newBot", async () => {
    await mount({ bots: [] });
    expect(host.textContent).toContain("Văn phòng 3D");
    expect(host.textContent).toContain("Văn phòng chưa có nhân sự");
    const createBtn = [...host.querySelectorAll("button")].find((btn) => btn.textContent?.includes("Tạo bot mới"));
    expect(createBtn).toBeTruthy();
    await act(async () => createBtn!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "newBot" });
  });

  it("lists desks in the roster, counts working bots, opens inspector on selection, and jumps to 2D map", async () => {
    const atlas = makeBot({ id: "atlas", name: "Atlas", section: "Kỹ thuật", chiefOfStaff: true, busy: true });
    const luna = makeBot({ id: "luna", name: "Luna", section: "Marketing", color: "orange", busy: false });
    await mount({ bots: [atlas, luna], sections: ["Kỹ thuật", "Marketing"] });

    expect(host.textContent).toContain("1 đang làm việc");
    expect(host.textContent).toContain("Bàn làm việc · 2");

    const atlasRosterBtn = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find((btn) => btn.textContent?.includes("Atlas"));
    expect(atlasRosterBtn).toBeTruthy();
    await act(async () => atlasRosterBtn!.click());

    const inspector = host.querySelector('[data-office-inspector="atlas"]');
    expect(inspector).toBeTruthy();
    expect(inspector!.textContent).toContain("Kỹ thuật");

    const mapBtn = [...host.querySelectorAll<HTMLButtonElement>("header button")].find((btn) => btn.textContent?.includes("Sơ đồ 2D"));
    expect(mapBtn).toBeTruthy();
    await act(async () => mapBtn!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "showTeamMap" });
  });

  it("shows bots talking when a group conversation is active and supports the live demo toggle", async () => {
    const atlas = makeBot({ id: "atlas", name: "Atlas", section: "Kỹ thuật", chiefOfStaff: true });
    const luna = makeBot({ id: "luna", name: "Luna", section: "Marketing", color: "orange" });
    const nova = makeBot({ id: "nova", name: "Nova", section: "Kỹ thuật", color: "purple" });
    const room: Group = {
      id: "room-dm",
      threadId: "t-dm",
      name: "Trao đổi",
      dm: true,
      memberIds: ["atlas", "luna"],
      defaultResponder: { kind: "mentions" },
      bulletin: "",
      unread: false,
      createdAt: Date.now(),
      working: true,
      busyBotId: "atlas",
      messages: [
        {
          id: "m1",
          role: "bot",
          kind: "text",
          text: "Chốt giao diện nhé Luna!",
          at: Date.now(),
          from: { botId: "atlas", name: "Atlas", color: "blue" },
        },
      ],
    };

    await mount({ bots: [atlas, luna, nova], sections: ["Kỹ thuật", "Marketing"], groups: [room] });
    expect(host.textContent).toContain("2 đang trao đổi");

    const atlasRosterBtn = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find((btn) => btn.textContent?.includes("Atlas"));
    await act(async () => atlasRosterBtn!.click());
    expect(host.querySelector('[data-office-inspector="atlas"]')?.textContent).toContain("Đang trao đổi với Luna");

    const demoBtn = host.querySelector<HTMLButtonElement>("[data-office-demo-toggle]");
    expect(demoBtn).toBeTruthy();
    expect(demoBtn!.textContent).toContain("Xem thử hoạt động");
    await act(async () => demoBtn!.click());
    expect(demoBtn!.textContent).toContain("Đang diễn thử");
    expect(host.textContent).toContain("1 đang làm việc");
  });

  it("opens the KPI board, surfaces waiting alerts, and dispatches usage & schedule shortcuts", async () => {
    const chief = makeBot({
      id: "chief",
      name: "Minh Quân",
      section: "Kỹ thuật",
      chiefOfStaff: true,
      busy: true,
      activity: "working",
      tasks: [
        {
          threadId: "task-1",
          title: "Triển khai giao diện",
          createdAt: 1_700_000_000_000,
          usage: { input: 42_000, output: 8_000, cachedInput: 21_000, costUsd: 0.35, turns: 7 },
        },
      ],
    });
    const waitingBot = makeBot({
      id: "mkt",
      name: "Gia Hân",
      section: "Marketing",
      activity: "waiting-on-you",
    });

    await mount({ bots: [chief, waitingBot], sections: ["Kỹ thuật", "Marketing"] });

    const kpiToggle = host.querySelector<HTMLButtonElement>("[data-office-kpi-toggle]");
    expect(kpiToggle).toBeTruthy();
    expect(kpiToggle!.textContent).toContain("Bảng KPI");
    expect(kpiToggle!.textContent).toContain("1");

    await act(async () => kpiToggle!.click());

    const kpiPanel = host.querySelector("[data-office-kpi-panel]");
    expect(kpiPanel).toBeTruthy();
    expect(kpiPanel!.textContent).toContain("Bảng chỉ số KPI");
    expect(kpiPanel!.textContent).toContain("Gia Hân đang chờ bạn duyệt / trả lời");
    expect(kpiPanel!.textContent).toContain("50K");
    expect(kpiPanel!.textContent).toContain("$0.35");

    const usageBtn = [...kpiPanel!.querySelectorAll<HTMLButtonElement>("button")].find((btn) =>
      btn.textContent?.includes("Chi tiết chi phí"),
    );
    await act(async () => usageBtn!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "usage" });

    const routinesBtn = [...kpiPanel!.querySelectorAll<HTMLButtonElement>("button")].find((btn) =>
      btn.textContent?.includes("Xem lịch chạy"),
    );
    await act(async () => routinesBtn!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "showRoutines" });
  });

  it("chats and assigns goals directly inside the 3D office without leaving virtual-office view", async () => {
    const giaHan = makeBot({
      id: "gia-han",
      name: "Gia Hân",
      threadId: "thread-mkt",
      section: "Marketing",
      title: "Chiến lược nội dung",
      busy: true,
      messages: [
        {
          id: "msg-1",
          role: "bot",
          kind: "text",
          text: "Mình đã sẵn sàng nhận chiến dịch mới.",
          at: 1_700_000_000_000,
        },
      ],
    });

    await mount({ bots: [giaHan], sections: ["Marketing"] });

    const rosterBtn = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find((btn) =>
      btn.textContent?.includes("Gia Hân"),
    );
    expect(rosterBtn).toBeTruthy();
    await act(async () => rosterBtn!.click());

    const card = host.querySelector('[data-office-inspector="gia-han"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("Mình đã sẵn sàng nhận chiến dịch mới.");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "select" }));

    const goalModeBtn = card!.querySelector<HTMLButtonElement>('[data-office-mode="goal"]');
    expect(goalModeBtn).toBeTruthy();
    await act(async () => goalModeBtn!.click());

    const textarea = card!.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "Lên kịch bản 5 video TikTok gắn giỏ hàng");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const sendBtn = card!.querySelector<HTMLButtonElement>("[data-office-send]");
    expect(sendBtn).toBeTruthy();
    expect(sendBtn!.disabled).toBe(false);
    await act(async () => sendBtn!.click());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send",
        botId: "gia-han",
        threadId: "thread-mkt",
        text: "Lên kịch bản 5 video TikTok gắn giỏ hàng",
        mode: "goal",
      }),
    );

    const stopBtn = card!.querySelector<HTMLButtonElement>("[data-office-stop-turn]");
    expect(stopBtn).toBeTruthy();
    await act(async () => stopBtn!.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "interrupt",
      botId: "gia-han",
      threadId: "thread-mkt",
    });
  });

  it("pairs two bots via drag-and-drop and dispatches a joint task right inside the 3D office", async () => {
    const giaHan = makeBot({ id: "gia-han", name: "Gia Hân", section: "Marketing", color: "coral" });
    const baoNgoc = makeBot({ id: "bao-ngoc", name: "Bảo Ngọc", section: "Kỹ thuật", color: "purple" });
    const createdGroup: Group = {
      id: "pair-room-1",
      threadId: "pair-thread-1",
      name: "Gia Hân · Bảo Ngọc",
      memberIds: ["gia-han", "bao-ngoc"],
      defaultResponder: { kind: "member", botId: "bao-ngoc" },
      bulletin: "",
      unread: false,
      createdAt: 1_700_000_000_000,
      messages: [],
    };

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/api/groups") return { group: createdGroup };
      return { collaborations: [], queued: [], running: [] };
    });

    await mount({ bots: [giaHan, baoNgoc], sections: ["Kỹ thuật", "Marketing"] });

    const sourceDesk = host.querySelector<HTMLElement>('[data-office-desk="gia-han"]');
    const targetDesk = host.querySelector<HTMLElement>('[data-office-desk="bao-ngoc"]');
    expect(sourceDesk).toBeTruthy();
    expect(targetDesk).toBeTruthy();

    const transferStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "move",
      setData: (mime: string, val: string) => transferStore.set(mime, val),
      getData: (mime: string) => transferStore.get(mime) ?? "",
    };

    await act(async () => {
      const startEvt = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(startEvt, "dataTransfer", { value: dataTransfer });
      sourceDesk!.dispatchEvent(startEvt);

      const overEvt = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(overEvt, "dataTransfer", { value: dataTransfer });
      targetDesk!.dispatchEvent(overEvt);

      const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, "dataTransfer", { value: dataTransfer });
      targetDesk!.dispatchEvent(dropEvt);
    });

    const pairCard = host.querySelector("[data-office-pair-card]");
    expect(pairCard).toBeTruthy();
    expect(pairCard!.textContent).toContain("Phối hợp 2 bot · Gia Hân & Bảo Ngọc");
    expect(pairCard!.textContent).toContain("Gia Hân đã sang bàn Bảo Ngọc để phối hợp");

    const quickCollaborateBtn = pairCard!.querySelector<HTMLButtonElement>('[data-office-pair-quick="collaborate"]');
    expect(quickCollaborateBtn).toBeTruthy();
    await act(async () => {
      quickCollaborateBtn!.click();
    });

    expect(api).toHaveBeenCalledWith(
      "/api/groups",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "groupPatched", group: createdGroup });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sendGroup",
        groupId: "pair-room-1",
        threadId: "pair-thread-1",
        mode: "chat",
        mentions: ["gia-han", "bao-ngoc"],
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "select" }));
  });

  it("transfers a bot to another department via drag-and-drop confirmation without leaving 3D", async () => {
    const giaHan = makeBot({ id: "gia-han", name: "Gia Hân", section: "Marketing", color: "coral" });
    const baoNgoc = makeBot({ id: "bao-ngoc", name: "Bảo Ngọc", section: "Kỹ thuật", color: "purple" });
    const movedBot = { ...giaHan, section: "Kỹ thuật" };

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/api/sidebar-sections") {
        return { sections: ["Kỹ thuật", "Marketing"], bots: [movedBot] };
      }
      return { collaborations: [], queued: [], running: [] };
    });

    await mount({ bots: [giaHan, baoNgoc], sections: ["Kỹ thuật", "Marketing"] });

    const sourceDesk = host.querySelector<HTMLElement>('[data-office-desk="gia-han"]');
    const targetZone = host.querySelector<HTMLElement>('[data-office-zone-drop="Kỹ thuật"]');
    expect(sourceDesk).toBeTruthy();
    expect(targetZone).toBeTruthy();

    const transferStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "move",
      setData: (mime: string, val: string) => transferStore.set(mime, val),
      getData: (mime: string) => transferStore.get(mime) ?? "",
    };

    await act(async () => {
      const startEvt = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(startEvt, "dataTransfer", { value: dataTransfer });
      sourceDesk!.dispatchEvent(startEvt);

      const overEvt = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(overEvt, "dataTransfer", { value: dataTransfer });
      targetZone!.dispatchEvent(overEvt);

      const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, "dataTransfer", { value: dataTransfer });
      targetZone!.dispatchEvent(dropEvt);
    });

    const dialog = document.body.querySelector('[role="alertdialog"], [role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain("Gia Hân");
    expect(dialog!.textContent).toContain("Kỹ thuật");

    const confirmBtn = [...dialog!.querySelectorAll<HTMLButtonElement>("button")].find(
      (btn) => btn.textContent?.trim() && !btn.textContent.includes("Hủy"),
    );
    expect(confirmBtn).toBeTruthy();
    await act(async () => {
      confirmBtn!.click();
    });

    expect(api).toHaveBeenCalledWith(
      "/api/sidebar-sections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Kỹ thuật", botIds: ["gia-han"] }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "sections", sections: ["Kỹ thuật", "Marketing"] });
    expect(dispatch).toHaveBeenCalledWith({ type: "botPatched", bot: movedBot });
    expect(host.querySelector("[data-office-move-notice]")?.textContent).toContain("Đã chuyển Gia Hân sang Kỹ thuật");
  });

  it("summons a department to the 3D Roundtable and dispatches a multi-bot project goal inside 3D", async () => {
    const minhQuan = makeBot({ id: "minh-quan", name: "Minh Quân", section: "Kỹ thuật", chiefOfStaff: true });
    const baoNgoc = makeBot({ id: "bao-ngoc", name: "Bảo Ngọc", section: "Kỹ thuật", color: "purple" });
    const giaHan = makeBot({ id: "gia-han", name: "Gia Hân", section: "Marketing", color: "coral" });
    const roundtableGroup: Group = {
      id: "roundtable-eng",
      threadId: "thread-roundtable-eng",
      name: "Họp bàn tròn · Kỹ thuật",
      section: "Kỹ thuật",
      memberIds: ["minh-quan", "bao-ngoc"],
      defaultResponder: { kind: "member", botId: "minh-quan" },
      bulletin: "",
      unread: false,
      createdAt: 1_700_000_000_000,
      messages: [],
    };

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/api/groups") return { group: roundtableGroup };
      return { collaborations: [], queued: [], running: [] };
    });

    await mount({ bots: [minhQuan, baoNgoc, giaHan], sections: ["Kỹ thuật", "Marketing"] });

    const roundtableToggle = host.querySelector<HTMLButtonElement>("[data-office-roundtable-toggle]");
    expect(roundtableToggle).toBeTruthy();
    expect(roundtableToggle!.textContent).toContain("Họp bàn tròn");
    await act(async () => roundtableToggle!.click());

    const card = host.querySelector("[data-office-roundtable-card]");
    expect(card).toBeTruthy();
    expect(host.textContent).toContain("3 đang trao đổi");

    const deptBtn = card!.querySelector<HTMLButtonElement>('[data-office-roundtable-dept="Kỹ thuật"]');
    expect(deptBtn).toBeTruthy();
    await act(async () => deptBtn!.click());
    expect(host.textContent).toContain("2 đang trao đổi");
    expect(card!.textContent).toContain("Chủ trì: Minh Quân");

    const goalModeBtn = card!.querySelector<HTMLButtonElement>('[data-office-roundtable-mode="goal"]');
    expect(goalModeBtn).toBeTruthy();
    await act(async () => goalModeBtn!.click());

    const composer = card!.querySelector<HTMLTextAreaElement>("[data-office-roundtable-composer]");
    expect(composer).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(composer, "Xây dựng cổng thanh toán mới và bộ kiểm thử tự động");
      composer!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const sendBtn = card!.querySelector<HTMLButtonElement>("[data-office-roundtable-send]");
    expect(sendBtn).toBeTruthy();
    await act(async () => sendBtn!.click());

    expect(api).toHaveBeenCalledWith(
      "/api/groups",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "groupPatched", group: roundtableGroup });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sendGroup",
        groupId: "roundtable-eng",
        threadId: "thread-roundtable-eng",
        text: "Xây dựng cổng thanh toán mới và bộ kiểm thử tự động",
        mode: "goal",
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "select" }));
  });

  it("gathers bots dragged onto the 3D Roundtable and runs a standup before adjourning", async () => {
    const minhQuan = makeBot({ id: "minh-quan", name: "Minh Quân", section: "Kỹ thuật", chiefOfStaff: true });
    const baoNgoc = makeBot({ id: "bao-ngoc", name: "Bảo Ngọc", section: "Kỹ thuật", color: "purple" });
    const giaHan = makeBot({ id: "gia-han", name: "Gia Hân", section: "Marketing", color: "coral" });
    const standupGroup: Group = {
      id: "roundtable-standup",
      threadId: "thread-standup",
      name: "Gia Hân, Minh Quân, Bảo Ngọc",
      memberIds: ["minh-quan", "gia-han", "bao-ngoc"],
      defaultResponder: { kind: "member", botId: "minh-quan" },
      bulletin: "",
      unread: false,
      createdAt: 1_700_000_000_000,
      messages: [],
    };

    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/api/groups") return { group: standupGroup };
      return { collaborations: [], queued: [], running: [] };
    });

    await mount({ bots: [minhQuan, baoNgoc, giaHan], sections: ["Kỹ thuật", "Marketing"] });

    const meetingDrop = host.querySelector<HTMLElement>("[data-office-meeting-drop]");
    const giaHanDesk = host.querySelector<HTMLElement>('[data-office-desk="gia-han"]');
    const baoNgocDesk = host.querySelector<HTMLElement>('[data-office-desk="bao-ngoc"]');
    expect(meetingDrop).toBeTruthy();
    expect(giaHanDesk).toBeTruthy();
    expect(baoNgocDesk).toBeTruthy();

    const dropBotOnTable = async (deskEl: HTMLElement) => {
      const store = new Map<string, string>();
      const dataTransfer = {
        effectAllowed: "move",
        setData: (mime: string, val: string) => store.set(mime, val),
        getData: (mime: string) => store.get(mime) ?? "",
      };
      await act(async () => {
        const startEvt = new Event("dragstart", { bubbles: true, cancelable: true });
        Object.defineProperty(startEvt, "dataTransfer", { value: dataTransfer });
        deskEl.dispatchEvent(startEvt);

        const overEvt = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperty(overEvt, "dataTransfer", { value: dataTransfer });
        meetingDrop!.dispatchEvent(overEvt);

        const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(dropEvt, "dataTransfer", { value: dataTransfer });
        meetingDrop!.dispatchEvent(dropEvt);
      });
    };

    await dropBotOnTable(giaHanDesk!);
    expect(host.querySelector("[data-office-roundtable-card]")).toBeTruthy();
    expect(host.textContent).toContain("2 đang trao đổi");

    await dropBotOnTable(baoNgocDesk!);
    expect(host.textContent).toContain("3 đang trao đổi");

    const standupBtn = host.querySelector<HTMLButtonElement>('[data-office-roundtable-quick="standup"]');
    expect(standupBtn).toBeTruthy();
    await act(async () => standupBtn!.click());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sendGroup",
        groupId: "roundtable-standup",
        threadId: "thread-standup",
        mode: "chat",
      }),
    );

    const adjournBtn = host.querySelector<HTMLButtonElement>("[data-office-roundtable-adjourn]");
    expect(adjournBtn).toBeTruthy();
    await act(async () => adjournBtn!.click());
    expect(host.querySelector("[data-office-roundtable-card]")).toBeNull();
  });

  it("hides live desktop screen controls in browser/VPS mode when no desktop stream exists", async () => {
    const giaHan = makeBot({ id: "gia-han", name: "Gia Hân", section: "Marketing", computer: undefined });
    await mount({ bots: [giaHan], sections: ["Marketing"] });

    expect(host.textContent).not.toContain("Màn hình trực tiếp");

    const rosterBtn = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find((btn) =>
      btn.textContent?.includes("Gia Hân"),
    );
    await act(async () => rosterBtn!.click());
    const card = host.querySelector('[data-office-inspector="gia-han"]');
    expect(card).toBeTruthy();
    expect(card!.querySelector('[aria-label="Xem màn hình"]')).toBeNull();
    expect(host.querySelector("[data-office-approval-pill]")).toBeNull();
  });

  it("surfaces a 1-click Quick Approval Queue across waiting bots and auto-advances until cleared", async () => {
    const commandBot = makeBot({
      id: "hoang-anh",
      threadId: "thread-hoang-anh",
      name: "Hoàng Anh",
      section: "Kỹ thuật",
      busy: true,
      activity: "working",
      messages: [
        {
          id: "msg-bash-1",
          role: "bot",
          kind: "options",
          at: 1_000,
          card: {
            requestId: "elicitation:elicit-1",
            title: "Run deploy check",
            subtitle: "pnpm test",
            tool: "Bash",
            options: ["Allow", "Deny"],
            commandAllowlist: { command: "pnpm test", cwd: "/repo", providerInstanceId: "inst-1" },
          },
        },
      ],
    });

    const questionBot = makeBot({
      id: "gia-han",
      threadId: "thread-gia-han",
      name: "Gia Hân",
      section: "Marketing",
      activity: "waiting-on-you",
      messages: [
        {
          id: "msg-q-1",
          role: "bot",
          kind: "options",
          at: 2_000,
          card: {
            requestId: "elicitation:elicit-1",
            requestType: "question",
            title: "Chọn kênh ưu tiên tuần này?",
            subtitle: "",
            options: ["TikTok Reels (Recommended)", "Facebook Ads"],
            questionRequest: {
              version: 1,
              questions: [
                {
                  question: "Chọn kênh ưu tiên tuần này?",
                  options: [
                    { label: "TikTok Reels (Recommended)", description: "Tương tác tự nhiên cao" },
                    { label: "Facebook Ads", description: "Tệp remarketing sẵn có" },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    const replyBot = makeBot({
      id: "quoc-bao",
      threadId: "thread-quoc-bao",
      name: "Quốc Bảo",
      section: "Vận hành",
      activity: "waiting-on-you",
      messages: [
        {
          id: "msg-r-1",
          role: "bot",
          kind: "text",
          text: "Báo cáo kho đã xong, anh xác nhận để gửi đối tác nhé?",
          at: 3_000,
        },
      ],
    });

    await mount({
      bots: [replyBot, questionBot, commandBot],
      sections: ["Kỹ thuật", "Marketing", "Vận hành"],
    });

    const pill = host.querySelector<HTMLButtonElement>("[data-office-approval-pill]");
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("Cần duyệt ngay · 3");
    expect(pill!.textContent).toContain("Hoàng Anh");

    await act(async () => pill!.click());

    const queue = host.querySelector("[data-office-approval-queue]");
    expect(queue).toBeTruthy();
    expect(queue!.textContent).toContain("1/3");
    expect(queue!.textContent).toContain("Hoàng Anh");

    const allowBtn = queue!.querySelector<HTMLButtonElement>('[data-office-queue-action="allow"]');
    expect(allowBtn).toBeTruthy();
    await act(async () => allowBtn!.click());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decideRequest",
        threadId: "thread-hoang-anh",
        requestId: "elicitation:elicit-1",
        behavior: "allow",
      }),
    );

    expect(host.querySelector("[data-office-approval-queue]")?.textContent).toContain("1/2");
    expect(host.querySelector("[data-office-approval-queue]")?.textContent).toContain("Gia Hân");

    const choiceBtn = host.querySelector<HTMLButtonElement>('[data-office-queue-choice="TikTok Reels"]');
    expect(choiceBtn).toBeTruthy();
    await act(async () => choiceBtn!.click());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decideRequest",
        threadId: "thread-gia-han",
        requestId: "elicitation:elicit-1",
        behavior: "answer",
      }),
    );

    expect(host.querySelector("[data-office-approval-queue]")?.textContent).toContain("1/1");
    expect(host.querySelector("[data-office-approval-queue]")?.textContent).toContain("Quốc Bảo");

    const quickApproveBtn = host.querySelector<HTMLButtonElement>('[data-office-queue-quick="approve"]');
    expect(quickApproveBtn).toBeTruthy();
    await act(async () => quickApproveBtn!.click());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send",
        botId: "quoc-bao",
        threadId: "thread-quoc-bao",
        mode: "chat",
      }),
    );

    expect(host.querySelector("[data-office-approval-queue]")).toBeNull();
    expect(host.querySelector("[data-office-approval-pill]")).toBeNull();
    expect(host.querySelector("[data-office-move-notice]")?.textContent).toContain(
      "Đã xử lý xong mọi yêu cầu chờ duyệt",
    );
  });
});
