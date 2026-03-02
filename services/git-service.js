import { executeCommand } from "../utils.js";

/**
 * Fetch all remote branch names from origin.
 * @param {string} dir - Project directory
 * @returns {Promise<string[]>}
 */
export async function getRemoteBranches(dir) {
    await executeCommand(`cd ${dir} && git fetch origin`);

    const result = await executeCommand(
        `cd ${dir} && git branch -r | sed 's|origin/||' | sed 's/^[* ]*//' | grep -v HEAD`,
    );

    if (!result.success || !result.stdout) return [];

    return result.stdout
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean);
}

/**
 * Checkout and pull a branch.
 * @param {string} branch - Exact branch name
 * @param {string} dir - Project directory
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function checkoutBranch(branch, dir) {
    const result = await executeCommand(
        `cd ${dir} && git reset --hard && git checkout ${branch} && git pull origin ${branch}`,
    );

    return {
        success: result.success,
        message: result.success
            ? `Switched to ${branch}`
            : result.stderr || result.message,
    };
}
