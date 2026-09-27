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
