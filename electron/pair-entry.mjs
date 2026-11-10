// Security invariant: an external openmausbot://pair link never switches the window silently; main's own dialog names the
// verified host first (`connect` -> serverConnect.connectAsking).
import { parseServerInput } from "./server-address.mjs";

const PAIR_LINK_MAX = 2048;
const NAME_MAX = 60;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

/** Parsed `{ link, name }` for a valid `openmausbot://pair?...` deep link, else null. */
export function parsePairDeepLink(raw) {
  if (typeof raw !== "string" || raw.length > PAIR_LINK_MAX || raw !== raw.trim()) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "openmausbot:" || url.hostname !== "pair" || (url.pathname !== "" && url.pathname !== "/")) {
    return null;
  }
  if (url.username || url.password || url.port || !raw.startsWith("openmausbot://pair?")) return null;
  const parsed = parseServerInput(raw);
  if (!parsed.ok) return null;
  const rawName = url.searchParams.get("name");
  const cleanName = typeof rawName === "string" && !CONTROL.test(rawName)
    ? rawName.trim().replace(/\s+/g, " ").slice(0, NAME_MAX)
    : "";
  return {
    link: raw,
    ...(cleanName ? { name: cleanName } : {}),
  };
}

export function takePairDeepLink(argv) {
  let found = null;
  for (let index = argv.length - 1; index >= 0; index--) {
    const parsed = parsePairDeepLink(argv[index]);
    if (!parsed) continue;
    argv.splice(index, 1);
    if (!found) found = parsed;
  }
  return found;
}

export function createPairEntry({ reveal, connect, onError = () => {} }) {
  let pending = null, ready = false;
  async function deliver() {
    if (!ready || !pending) return false;
    const target = pending;
    pending = null;
    try {
      return Boolean(await connect(target.link, target.name));
    } catch (error) {
      await Promise.resolve(onError(error)).catch(() => {});
      return false;
    }
  }
  function request(parsed) {
    pending = parsed;
    reveal();
    void deliver();
    return true;
  }
  return {
    fromLaunch(argv) {
      const found = takePairDeepLink(argv);
      if (found) pending = found;
      return Boolean(found);
    },
    fromArgs(argv) {
      const found = takePairDeepLink(argv);
      return found ? request(found) : false;
    },
    fromUrl(url) {
      const found = parsePairDeepLink(url);
      return found ? request(found) : false;
    },
    ready() {
      ready = true;
      return deliver();
    },
  };
}
