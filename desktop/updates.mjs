// Update discovery for the packaged desktop app.
//
// Windows installers are updated in place by electron-updater. macOS builds are
// unsigned, so Squirrel.Mac refuses to apply them; those users are told a new
// version exists and are sent to the published release page to download it.
// Every dependency is injected so the release comparison stays testable without
// an Electron runtime.

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value ?? ""));
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

export function isNewerVersion(candidate, current) {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  if (!left || !right) return false;

  for (const part of ["major", "minor", "patch"]) {
    if (left[part] !== right[part]) return left[part] > right[part];
  }
  // A release without a prerelease suffix supersedes the matching prerelease.
  if (left.prerelease === right.prerelease) return false;
  if (!left.prerelease) return true;
  if (!right.prerelease) return false;
  return left.prerelease > right.prerelease;
}

export function selectLatestRelease(releases) {
  const list = Array.isArray(releases) ? releases : [releases];
  return list
    .filter((release) => release && !release.draft && !release.prerelease && release.tag_name)
    .map((release) => ({ version: parseVersion(release.tag_name), release }))
    .filter((item) => item.version)
    .sort((left, right) => (
      right.version.major - left.version.major
      || right.version.minor - left.version.minor
      || right.version.patch - left.version.patch
    ))[0]?.release;
}

export function releasesApiUrl(repository) {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

export function releasesPageUrl(repository) {
  return `https://github.com/${repository}/releases/latest`;
}

/**
 * Builds the macOS notify-only checker. Returns the dialog outcome so callers
 * and tests can assert what the user was offered.
 */
export function createManualUpdateChecker({
  repository,
  currentVersion,
  fetchImpl,
  askToDownload,
  openExternal,
  logError = () => {},
}) {
  return async function checkForManualUpdate() {
    try {
      const response = await fetchImpl(releasesApiUrl(repository), {
        headers: { accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const latest = selectLatestRelease(await response.json());
      if (!latest) return { status: "no_release" };

      const latestVersion = parseVersion(latest.tag_name);
      if (!isNewerVersion(latest.tag_name, currentVersion)) return { status: "up_to_date" };

      const accepted = await askToDownload({
        version: `${latestVersion.major}.${latestVersion.minor}.${latestVersion.patch}`,
        currentVersion,
      });
      if (accepted) await openExternal(releasesPageUrl(repository));
      return { status: accepted ? "download_opened" : "declined", version: latest.tag_name };
    } catch (error) {
      logError(error);
      return { status: "check_failed" };
    }
  };
}
