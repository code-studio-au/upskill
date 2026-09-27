interface InstalledRelatedApplication {
  platform: string;
}

interface RelatedApplicationsNavigator {
  getInstalledRelatedApps?: () => Promise<InstalledRelatedApplication[]>;
  standalone?: boolean;
}

interface StandaloneDisplay {
  matchMedia(query: string): { matches: boolean };
}

interface HandoffStorage {
  setItem(key: string, value: string): void;
}

export const OFFLINE_SCORM_PWA_HANDOFF_STORAGE_KEY =
  "upskill:offline-scorm:pending-handoff:v1";

export function isStandaloneApplication(
  display: StandaloneDisplay = window,
  runtimeNavigator: RelatedApplicationsNavigator = navigator as RelatedApplicationsNavigator,
): boolean {
  return (
    display.matchMedia("(display-mode: standalone)").matches ||
    Boolean(runtimeNavigator.standalone)
  );
}

export async function isRelatedWebApplicationInstalled(
  runtimeNavigator: RelatedApplicationsNavigator = navigator as RelatedApplicationsNavigator,
): Promise<boolean> {
  const getInstalledRelatedApps =
    runtimeNavigator.getInstalledRelatedApps?.bind(runtimeNavigator);
  if (!getInstalledRelatedApps) return false;

  try {
    const applications = await getInstalledRelatedApps();
    return applications.some(
      (application) => application.platform === "webapp",
    );
  } catch {
    // Installation detection is an optional browser capability. A denied or
    // unavailable query must fall back to the normal install prompt.
    return false;
  }
}

export function rememberOfflineScormPwaHandoff(
  targetUrl: string,
  storage: HandoffStorage = localStorage,
): boolean {
  try {
    const target = new URL(targetUrl);
    if (
      target.pathname !== "/offline-learning.html" ||
      target.href.length > 4_096
    )
      return false;
    storage.setItem(
      OFFLINE_SCORM_PWA_HANDOFF_STORAGE_KEY,
      `${target.pathname}${target.search}${target.hash}`,
    );
    return true;
  } catch {
    return false;
  }
}
