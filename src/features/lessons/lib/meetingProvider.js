const PROVIDER_RULES = [
  { id: "zoom", hosts: ["zoom.us"] },
  { id: "googleMeet", hosts: ["meet.google.com"] },
  {
    id: "microsoftTeams",
    hosts: ["teams.microsoft.com", "teams.live.com"],
  },
];

const hostMatches = (hostname, host) =>
  hostname === host || hostname.endsWith(`.${host}`);

export const detectMeetingProvider = (url) => {
  if (!url) return "generic";

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const provider = PROVIDER_RULES.find(({ hosts }) =>
      hosts.some((host) => hostMatches(hostname, host)),
    );

    return provider?.id || "generic";
  } catch {
    return "generic";
  }
};

export const getMeetingProviderLabel = (url, t) =>
  t(`meetingProviders.${detectMeetingProvider(url)}`);
