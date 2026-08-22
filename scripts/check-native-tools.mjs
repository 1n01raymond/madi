import { spawnSync } from "node:child_process";

const allowMissing = process.argv.includes("--allow-missing");
const commands = [
  { name: "CMake", command: "cmake", args: ["--version"] },
  { name: "C++ compiler", command: process.platform === "win32" ? "cl" : "c++", args: ["--version"] },
];

let missing = false;

for (const tool of commands) {
  const result = spawnSync(tool.command, tool.args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.error || result.status !== 0) {
    missing = true;
    console.warn(`[native] missing ${tool.name} (${tool.command})`);
    continue;
  }

  const firstLine = (result.stdout || result.stderr).split(/\r?\n/u)[0];
  console.log(`[native] ${tool.name}: ${firstLine}`);
}

if (missing && !allowMissing) {
  console.error(
    "Native prerequisites are incomplete. See native/adapter-occt/README.md.",
  );
  process.exitCode = 1;
}
