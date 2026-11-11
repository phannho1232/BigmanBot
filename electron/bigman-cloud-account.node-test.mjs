import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BIGMAN_SUPABASE_URL,
  BIGMAN_WEB_ORIGIN,
  bigmanCloudTarget,
  createBigmanCloudAccountClient,
} from "./bigman-cloud-account.mjs";
import { createCloudAccounts } from "./cloud-accounts.mjs";

function createMemoryStore(initial = null) {
  let value = initial;
  return {
    read: async () => value,
    write: async next => {
      value = next;
    },
  };
}

describe("bigman-cloud-account", () => {
  it("uses separate store files and bigmanbot.com origin so legacy OpenMausBot sessions are ignored", () => {
    const target = bigmanCloudTarget();
    assert.equal(target.origin, "https://bigmanbot.com");
    assert.equal(target.file, "bigman-cloud-account.bin");
    assert.equal(target.saved, "bigman-cloud-accounts.bin");
  });

  it("signs in with email and password, loads subscription and cloud_servers, and mints pairing codes", async () => {
    const store = createMemoryStore();
    const openedUrls = [];
    const states = [];

    const mockFetch = async (url, init = {}) => {
      const href = String(url);
      if (href === `${BIGMAN_SUPABASE_URL}/auth/v1/token?grant_type=password`) {
        const body = JSON.parse(init.body);
        if (body.password !== "correct-pass") {
          return new Response(JSON.stringify({ error: "invalid_grant", error_code: "invalid_credentials" }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            access_token: "jwt_access_123",
            refresh_token: "jwt_refresh_123",
            expires_in: 3600,
            user: { id: "user_uuid_12345678", email: body.email },
          }),
          { status: 200 },
        );
      }
      if (href === `${BIGMAN_SUPABASE_URL}/auth/v1/user`) {
        return new Response(JSON.stringify({ id: "user_uuid_12345678", email: "vip@bigmanbot.com" }), { status: 200 });
      }
      if (href.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/subscriptions`)) {
        return new Response(
          JSON.stringify([
            {
              plan_code: "pro",
              status: "active",
              billing_cycle: "monthly",
              expires_at: "2027-01-01T00:00:00Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (href.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/user_roles`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (href.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/cloud_servers`)) {
        return new Response(
          JSON.stringify([
            {
              id: "srv_uuid_999",
              plan_code: "pro",
              name: "Bigman Pro VPS",
              subdomain: "vip-cloud",
              domain: "vip-cloud.bigmanbot.com",
              origin: "https://vip-cloud.bigmanbot.com",
              ip_address: "103.1.2.3",
              status: "active",
              power_status: "running",
              bootstrap_status: "ready",
              date_end: "2027-01-01T00:00:00Z",
            },
          ]),
          { status: 200 },
        );
      }
      if (href.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/orders`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (href === `${BIGMAN_SUPABASE_URL}/functions/v1/vpsmmo-proxy`) {
        const body = JSON.parse(init.body);
        assert.equal(body.provider, "mint_pairing");
        assert.equal(body.serverId, "srv_uuid_999");
        return new Response(
          JSON.stringify({
            status: "success",
            code: "ABCD-EFGH-JKLM",
            origin: "https://vip-cloud.bigmanbot.com",
            expiresAt: 1800000000000,
          }),
          { status: 200 },
        );
      }
      if (href === `${BIGMAN_SUPABASE_URL}/auth/v1/logout`) {
        return new Response("{}", { status: 200 });
      }
      throw new Error(`Unexpected URL: ${href}`);
    };

    const client = createBigmanCloudAccountClient({
      store,
      openBrowser: async url => {
        openedUrls.push(url);
      },
      fetch: mockFetch,
      now: () => 1700000000000,
      onState: state => states.push(state),
      setTimer: () => ({ unref() {} }),
      clearTimer: () => {},
    });

    await client.start();
    assert.equal(client.state().status, "signed-out");

    const bad = await client.signInPassword("vip@bigmanbot.com", "wrong");
    assert.equal(bad.outcome, "invalid-credentials");

    const good = await client.signInPassword("vip@bigmanbot.com", "correct-pass");
    assert.equal(good.outcome, "signed-in");
    assert.equal(good.state.status, "connected");
    assert.equal(good.state.account?.email, "vip@bigmanbot.com");
    assert.equal(good.state.entitlement?.plan, "pro");
    assert.equal(good.state.entitlement?.tier, "pro");
    assert.equal(good.state.entitlement?.status, "active");
    assert.equal(good.state.machine?.status, "ready");
    assert.equal(good.state.machine?.origin, "https://vip-cloud.bigmanbot.com");
    assert.equal(good.state.machine?.moves, undefined);
    assert.equal(good.state.bigmanServers?.length, 1);
    assert.equal(good.state.bigmanServers?.[0]?.name, "Bigman Pro VPS");

    const grant = await client.pairHome("srv_uuid_999");
    assert.equal(grant.origin, "https://vip-cloud.bigmanbot.com");
    assert.equal(grant.code, "ABCDEFGHJKLM");

    await client.openDashboard();
    assert.deepEqual(openedUrls, [`${BIGMAN_WEB_ORIGIN}/pricing`]);

    await client.signOut();
    assert.equal(client.state().status, "signed-out");
    client.close();
  });

  it("works with createCloudAccounts multi-account ring via addPassword", async () => {
    const active = createMemoryStore();
    const saved = createMemoryStore();

    const makeMockClient = ({ store, onState }) =>
      createBigmanCloudAccountClient({
        store,
        openBrowser: async () => {},
        onState,
        now: () => 1700000000000,
        setTimer: () => ({ unref() {} }),
        clearTimer: () => {},
        fetch: async (url, init = {}) => {
          const href = String(url);
          if (href.includes("/auth/v1/token?grant_type=password")) {
            const body = JSON.parse(init.body);
            return new Response(
              JSON.stringify({
                access_token: `tok_${body.email}`,
                refresh_token: `ref_${body.email}`,
                expires_in: 3600,
                user: { id: `uid_${body.email}_123456`, email: body.email },
              }),
              { status: 200 },
            );
          }
          if (href.includes("/auth/v1/user")) {
            const auth = init.headers?.authorization || "";
            const email = auth.replace("Bearer tok_", "");
            return new Response(JSON.stringify({ id: `uid_${email}_123456`, email }), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        },
      });

    let mainClient = null;
    mainClient = makeMockClient({ store: active, onState: () => {} });
    await mainClient.signInPassword("first@bigmanbot.com", "pass1");

    const ring = createCloudAccounts({
      active,
      saved,
      client: () => mainClient,
      makeClient: makeMockClient,
      origin: BIGMAN_WEB_ORIGIN,
      now: () => 1700000000000,
    });

    await ring.start();
    const added = await ring.addPassword("second@bigmanbot.com", "pass2");
    assert.equal(added.outcome, "switched");
    assert.equal(mainClient.state().account?.email, "second@bigmanbot.com");
    assert.equal(ring.others().length, 1);
    assert.equal(ring.others()[0].email, "first@bigmanbot.com");
    ring.close();
    mainClient.close();
  });
});
