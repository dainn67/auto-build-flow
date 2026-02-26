import { readFileSync, existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";

// ─── Constants ───────────────────────────────────────────────────────────────
const CMS_DOMAIN =
    "https://test-api-cms-v2-dot-micro-enigma-235001.appspot.com";
const GOOGLE_PLAY_API =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const APP_STORE_API = "https://api.appstoreconnect.apple.com/v1";

// ─── CMS Helper ──────────────────────────────────────────────────────────────

/**
 * Fetch app config from CMS to resolve package name / bundle ID
 * @param {string} appName - e.g. "asvab", "cdl"
 * @returns {{ androidPackageName: string, iosBundleId: string, bucket: string }}
 */
async function fetchAppConfig(appName) {
    const res = await fetch(`${CMS_DOMAIN}/api/app/config/map`);
    if (!res.ok) throw new Error(`CMS request failed: ${res.status}`);
    const configMap = await res.json();

    const brand = configMap[appName];
    if (!brand?.edupassAndroid) {
        throw new Error(`App config not found for "${appName}"`);
    }

    const originalPkg = brand.edupassAndroid.packageName;
    const bucket = brand.bucket;

    // Android: ccna & asvab use com.edupass instead of com.easypass
    let androidPkg = originalPkg;
    if (bucket === "ccna" || bucket === "asvab") {
        androidPkg = originalPkg.replace("com.easypass.", "com.edupass.");
    }

    return {
        androidPackageName: androidPkg,
        iosBundleId: originalPkg, // iOS keeps the original
        bucket,
    };
}

// ─── Google Play (Android) ───────────────────────────────────────────────────

/**
 * Create a short-lived Google OAuth2 access token from a service-account JSON
 */
async function getGoogleAccessToken(serviceAccountPath) {
    const sa = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
    const now = Math.floor(Date.now() / 1000);

    const assertion = jwt.sign(
        {
            iss: sa.client_email,
            scope: "https://www.googleapis.com/auth/androidpublisher",
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
        },
        sa.private_key,
        { algorithm: "RS256" },
    );

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
    });

    const data = await res.json();
    if (!data.access_token) {
        throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`);
    }
    return data.access_token;
}

/**
 * Get the latest version from Google Play **internal** track
 * @returns {{ versionName: string|null, versionCode: number, source: string } | null}
 */
async function getAndroidVersion(packageName, serviceAccountPath) {
    if (!existsSync(serviceAccountPath)) {
        console.log(
            `⚠️  service_account.json not found – skipping Android version lookup`,
        );
        return null;
    }

    try {
        const token = await getGoogleAccessToken(serviceAccountPath);
        const headers = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };

        // 1. Create an Edit
        const editRes = await fetch(`${GOOGLE_PLAY_API}/${packageName}/edits`, {
            method: "POST",
            headers,
            body: "{}",
        });
        const edit = await editRes.json();
        if (!edit.id) throw new Error(`Create edit failed: ${JSON.stringify(edit)}`);
        const editId = edit.id;

        try {
            // 2. Get internal track
            const trackRes = await fetch(
                `${GOOGLE_PLAY_API}/${packageName}/edits/${editId}/tracks/internal`,
                { headers },
            );
            const track = await trackRes.json();

            const releases = track.releases;
            if (!releases?.length) return null;

            // Pick the newest release (first element)
            const latest = releases[0];
            const codes = (latest.versionCodes || []).map(Number);
            const highestCode = codes.length ? Math.max(...codes) : 0;

            // Release name format set by upload.py: "60 (1.1.0)"
            let versionName = null;
            if (latest.name) {
                const m = latest.name.match(/\((.+)\)/);
                if (m) versionName = m[1].trim();
            }

            return { versionName, versionCode: highestCode, source: "google_play" };
        } finally {
            // Cleanup: delete the edit (don't commit)
            await fetch(
                `${GOOGLE_PLAY_API}/${packageName}/edits/${editId}`,
                { method: "DELETE", headers },
            ).catch(() => { });
        }
    } catch (err) {
        console.error(
            `❌ Android version lookup failed for ${packageName}:`,
            err.message,
        );
        return null;
    }
}

// ─── App Store Connect (iOS / TestFlight) ────────────────────────────────────

/**
 * Generate a JWT for the App Store Connect API
 */
function generateAppleJWT(apiKeyDir) {
    const configPath = join(apiKeyDir, "api_key_config.json");
    if (!existsSync(configPath)) {
        throw new Error(`Missing ${configPath}`);
    }

    const { key_id, issuer_id } = JSON.parse(readFileSync(configPath, "utf8"));
    if (!key_id || !issuer_id) {
        throw new Error("key_id or issuer_id missing in api_key_config.json");
    }

    const p8Path = join(apiKeyDir, `AuthKey_${key_id}.p8`);
    if (!existsSync(p8Path)) {
        throw new Error(`Missing API key file: ${p8Path}`);
    }

    const privateKey = readFileSync(p8Path, "utf8");
    const now = Math.floor(Date.now() / 1000);

    return jwt.sign(
        {
            iss: issuer_id,
            iat: now,
            exp: now + 20 * 60,
            aud: "appstoreconnect-v1",
        },
        privateKey,
        {
            algorithm: "ES256",
            header: { alg: "ES256", kid: key_id, typ: "JWT" },
        },
    );
}

/**
 * Get the latest TestFlight build version
 * @returns {{ versionName: string|null, versionCode: number, source: string } | null}
 */
async function getIOSVersion(bundleId, apiKeyDir) {
    if (!existsSync(join(apiKeyDir, "api_key_config.json"))) {
        console.log(
            `⚠️  ios_api_key/api_key_config.json not found – skipping iOS version lookup`,
        );
        return null;
    }

    try {
        const token = generateAppleJWT(apiKeyDir);
        const headers = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };

        // 1. Resolve App ID from bundleId
        const appsRes = await fetch(
            `${APP_STORE_API}/apps?filter[bundleId]=${bundleId}`,
            { headers },
        );
        const apps = await appsRes.json();
        if (!apps.data?.length) {
            console.error(`❌ No iOS app found for bundleId: ${bundleId}`);
            return null;
        }
        const appId = apps.data[0].id;

        // 2. Get latest TestFlight build (sorted by newest first)
        const buildsRes = await fetch(
            `${APP_STORE_API}/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1&include=preReleaseVersion`,
            { headers },
        );
        const builds = await buildsRes.json();
        if (!builds.data?.length) {
            console.error(`❌ No TestFlight builds for ${bundleId}`);
            return null;
        }

        const latestBuild = builds.data[0];
        const buildNumber = parseInt(latestBuild.attributes.version, 10);

        // Version name from the included preReleaseVersion relationship
        let versionName = null;
        const preRelease = builds.included?.find(
            (i) => i.type === "preReleaseVersions",
        );
        if (preRelease) {
            versionName = preRelease.attributes.version;
        }

        return { versionName, versionCode: buildNumber, source: "testflight" };
    } catch (err) {
        console.error(
            `❌ iOS version lookup failed for ${bundleId}:`,
            err.message,
        );
        return null;
    }
}

// ─── Version helpers ─────────────────────────────────────────────────────────

/** Compare two semver strings (a > b → positive, a < b → negative) */
function compareSemver(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Increment version: patch +1, build number +1
 * e.g. "1.2.3" → "1.2.4",  buildNumber 45 → 46
 */
function incrementVersion(versionName, versionCode) {
    let newVersion = "1.0.1";
    let newBuild = 2;

    if (versionName) {
        const parts = versionName.split(".");
        if (parts.length >= 3) {
            parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
            newVersion = parts.join(".");
        }
    }

    if (versionCode && versionCode > 0) {
        newBuild = versionCode + 1;
    }

    return { versionName: newVersion, buildNumber: newBuild };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the latest store version for a list of apps, pick the highest,
 * and return the **incremented** version ready for the next build.
 *
 * @param {string[]} appNames  – e.g. ["asvab", "cdl"]
 * @param {string} flutterDir  – root of the Flutter project (contains service_account.json & ios_api_key/)
 * @returns {{ versionName: string, buildNumber: number }}
 */
export async function getLatestVersionForApps(appNames, flutterDir) {
    const serviceAccountPath = join(flutterDir, "service_account.json");
    const apiKeyDir = join(flutterDir, "ios_api_key");

    let bestVersionName = null;
    let bestVersionCode = 0;

    // Query each app in parallel (typically only 1-3 apps per build)
    const results = await Promise.allSettled(
        appNames.map(async (appName) => {
            try {
                const cfg = await fetchAppConfig(appName);
                console.log(
                    `🔍 Looking up store versions for "${appName}" (Android: ${cfg.androidPackageName}, iOS: ${cfg.iosBundleId})`,
                );

                const [android, ios] = await Promise.all([
                    getAndroidVersion(cfg.androidPackageName, serviceAccountPath),
                    getIOSVersion(cfg.iosBundleId, apiKeyDir),
                ]);

                if (android) {
                    console.log(
                        `  📱 Android: ${android.versionName} (code ${android.versionCode})`,
                    );
                }
                if (ios) {
                    console.log(
                        `  🍎 iOS:     ${ios.versionName} (build ${ios.versionCode})`,
                    );
                }

                return { android, ios };
            } catch (e) {
                console.error(`  ❌ Skipping "${appName}": ${e.message}`);
                return null;
            }
        }),
    );

    // Pick the highest version across all apps & both platforms
    for (const r of results) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const { android, ios } = r.value;

        for (const info of [android, ios]) {
            if (!info) continue;
            if (info.versionCode > bestVersionCode) {
                bestVersionCode = info.versionCode;
            }
            if (
                info.versionName &&
                (!bestVersionName || compareSemver(info.versionName, bestVersionName) > 0)
            ) {
                bestVersionName = info.versionName;
            }
        }
    }

    if (!bestVersionName && bestVersionCode === 0) {
        console.log(
            `⚠️  No store version found for any app – using default 1.0.0 (1)`,
        );
        return { versionName: "1.0.1", buildNumber: 2 };
    }

    const next = incrementVersion(bestVersionName, bestVersionCode);
    console.log(
        `📦 Store latest: ${bestVersionName} (${bestVersionCode}) → Next build: ${next.versionName} (${next.buildNumber})`,
    );
    return next;
}

/**
 * Parse app names from a generated script string.
 * Script format:
 *   VERSION=1.2.3
 *   BUILD_NUMBER=45
 *   LIST_APP={
 *     "asvab"
 *     "cdl"
 *   }
 */
export function parseAppNamesFromScript(script) {
    const matches = script.match(/"([^"]+)"/g);
    if (!matches) return [];
    return matches.map((m) => m.replace(/"/g, ""));
}

/**
 * Replace VERSION and BUILD_NUMBER in a script string
 */
export function replaceVersionInScript(script, versionName, buildNumber) {
    return script
        .replace(/VERSION=\S+/, `VERSION=${versionName}`)
        .replace(/BUILD_NUMBER=\S+/, `BUILD_NUMBER=${buildNumber}`);
}
