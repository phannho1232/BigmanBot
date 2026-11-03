/** The Composio apps Connected apps lists when the catalog cannot be read. Product analytics names these apps, and only these. */
export const CURATED_CONNECTOR_SLUGS = [
  "googlesheets", "googledocs", "googledrive", "gmail", "googlecalendar", "canva", "youtube", "facebook",
  "notion", "trello", "figma", "google_analytics", "google_meet", "zoom", "outlook", "onedrive", "microsoft_teams",
  "airtable", "jira", "slack", "discord", "github", "zapier", "dropbox", "hubspot", "linkedin",
] as const;

export type CuratedConnectorSlug = (typeof CURATED_CONNECTOR_SLUGS)[number];
