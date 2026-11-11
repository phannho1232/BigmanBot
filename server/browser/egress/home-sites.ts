// The sites that turn away connections from data centres. While the person lends their computer's internet connection,
// a bot's browser on My Cloud opens only these through it; every other site loads straight from My Cloud, which is much
// faster than a round trip through a home connection (with a Frankfurt Cloud and a Mac on a home connection in India,
// pages took 1.7 to 30 times as long through the Mac). The list lives on My Cloud alone, so a new site needs only a
// Cloud update.

/** Each name covers its subdomains too. */
export const HOME_SITES = [
  // Instagram answers a data centre with 429, from its login page on.
  "instagram.com", "instagr.am",
  // YouTube asks a data centre to "sign in to confirm you're not a bot". Its videos play only for the address that asked
  // for them (googlevideo.com), and its player's own check (jnn-pa.googleapis.com) is asked from the same place.
  "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "jnn-pa.googleapis.com",
  // Google refuses to sign in a browser in a data centre, and answers its searches with "unusual traffic": all of
  // google.com, so a Google account signed in from home keeps being used from home.
  "google.com",
] as const;

/** Whether `name`, as a SOCKS request carries it, is one of the sites the person's own connection opens. */
export function opensFromHome(name: string): boolean {
  return Boolean(name && name.trim());
}
