import assert from "node:assert/strict";
import test from "node:test";
import { createPairEntry, parsePairDeepLink, takePairDeepLink } from "./pair-entry.mjs";

const VALID_LINK = "openmausbot://pair?address=https%3A%2F%2Fshop1.bigmanbot.com&code=7KQ2-M9XD-H4TP&name=Bigman%20Cloud%20Pro";

test("parsePairDeepLink accepts only well-formed openmausbot://pair links with a valid server address", () => {
  assert.deepEqual(parsePairDeepLink(VALID_LINK), {
    link: VALID_LINK,
    name: "Bigman Cloud Pro",
  });
  assert.deepEqual(parsePairDeepLink("openmausbot://pair?address=https%3A%2F%2Fshop1.bigmanbot.com"), {
    link: "openmausbot://pair?address=https%3A%2F%2Fshop1.bigmanbot.com",
  });

  for (const invalid of [
    null,
    undefined,
    "",
    ` ${VALID_LINK}`,
    "openmausbot://cloud",
    "openmausbot://pair",
    "openmausbot://pair/",
    "openmausbot://pair?url=https%3A%2F%2Fshop1.bigmanbot.com%2Fpair%23code%3D7KQ2-M9XD-H4TP",
    "openmausbot://pair?address=http%3A%2F%2Fshop1.bigmanbot.com&code=7KQ2-M9XD-H4TP",
    "openmausbot://pair?address=192.168.1.20&port=8810&token=x",
    "openmausbot://user@pair?address=https%3A%2F%2Fshop1.bigmanbot.com",
    "openmausbot://pair:443?address=https%3A%2F%2Fshop1.bigmanbot.com",
    `openmausbot://pair?address=https%3A%2F%2F${"a".repeat(2100)}.bigmanbot.com`,
  ]) {
    assert.equal(parsePairDeepLink(invalid), null, String(invalid));
  }
});

test("takePairDeepLink strips only valid pair deep links from argv and keeps the latest one", () => {
  const first = "openmausbot://pair?address=https%3A%2F%2Fone.bigmanbot.com&code=AAAA-BBBB-CCCC";
  const second = "openmausbot://pair?address=https%3A%2F%2Ftwo.bigmanbot.com&code=DDDD-EEEE-FFFF&name=Two";
  const argv = ["/app/BigmanBot", "--fixture", first, "openmausbot://cloud", second];
  const taken = takePairDeepLink(argv);
  assert.deepEqual(taken, { link: second, name: "Two" });
  assert.deepEqual(argv, ["/app/BigmanBot", "--fixture", "openmausbot://cloud"]);
});

test("createPairEntry queues cold-start links until ready and delivers live links immediately after", async () => {
  const calls = [];
  let revealed = 0;
  const entry = createPairEntry({
    reveal: () => { revealed++; },
    connect: async (link, name) => { calls.push([link, name]); return true; },
  });

  const argv = ["C:\\BigmanBot.exe", VALID_LINK];
  assert.equal(entry.fromLaunch(argv), true);
  assert.deepEqual(argv, ["C:\\BigmanBot.exe"]);
  assert.equal(calls.length, 0);

  assert.equal(await entry.ready(), true);
  assert.deepEqual(calls, [[VALID_LINK, "Bigman Cloud Pro"]]);

  const live = "openmausbot://pair?address=https%3A%2F%2Flive.bigmanbot.com&code=2345-6789-ABCD";
  assert.equal(entry.fromUrl(live), true);
  await Promise.resolve();
  assert.equal(revealed, 1);
  assert.deepEqual(calls.at(-1), [live, undefined]);
});
