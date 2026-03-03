import { promises as fs } from "fs";
import { spawn } from "child_process";

/**
 * Replace the full content of a file with the provided string
 * @param {string} filePath - Path to the file to write
 * @param {string} newContent - New content to write to the file
 * @returns {Promise<string>} Success message
 */
async function replaceFileContent(filePath, newContent) {
  try {
    await fs.writeFile(filePath, newContent, "utf8");
    return `✅ File updated successfully: ${filePath}`;
  } catch (error) {
    throw new Error(`❌ Failed to write file: ${error.message}`);
  }
}

/**
 * Execute a terminal command in the system shell with real-time output
 * @param {string} command - Command to execute
 * @returns {Promise<{stdout: string, stderr: string}>} Command output
 */
async function executeCommand(command) {
  return new Promise((resolve) => {
    console.log(`🔧 EXECUTING: ${command}`);

    // Run the full command string in the shell (no args to avoid DEP0190)
    const childProcess = spawn(command, [], {
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    // Stream stdout in real-time
    childProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output); // Print in real-time
    });

    // Stream stderr in real-time
    childProcess.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      process.stderr.write(output); // Print in real-time
    });

    // Handle process exit
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          message: `✅ Command executed successfully: ${command}`,
          exitCode: code,
        });
      } else {
        resolve({
          success: false,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          message: `❌ Command failed with exit code: ${code}`,
          exitCode: code,
        });
      }
    });

    // Handle process errors
    childProcess.on("error", (error) => {
      console.log(`❌ Failed to execute command: ${error.message}`);
      resolve({
        success: false,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        message: `❌ Failed to execute command: ${error.message}`,
        exitCode: -1,
      });
    });
  });
}

// Example usage
async function main() {
  // Example 1: Replace file content
  const filePath = "./example.txt";
  const newContent = "Hello World!\nThis is the new content.";

  try {
    const fileResult = await replaceFileContent(filePath, newContent);
    console.log(fileResult);
  } catch (error) {
    console.error(error.message);
  }

  // Example 2: Execute command
  const command = 'echo "Hello from shell"';

  const cmdResult = await executeCommand(command);
  console.log(cmdResult.message);
  if (cmdResult.stdout) {
    console.log("Output:", cmdResult.stdout);
  }
  if (cmdResult.stderr) {
    console.log("Error output:", cmdResult.stderr);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { replaceFileContent, executeCommand };
