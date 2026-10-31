import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";
import { getRunsDir, launchRun, type RunMetadata } from "./shared.ts";

const saved = { PATH: process.env.PATH, HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
let scratch: string;
let argsLog: string;

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), "pi-subagent-test-"));
	argsLog = join(scratch, "tmux-args");
	// A fake tmux that records its arguments, one per line, instead of starting a session.
	const fakeTmux = join(scratch, "tmux");
	writeFileSync(fakeTmux, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsLog}'\n`);
	chmodSync(fakeTmux, 0o755);
	process.env.PATH = `${scratch}:${saved.PATH}`;
	process.env.HOME = join(scratch, "home");
	delete process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(scratch, { recursive: true, force: true });
});

function launchedAgentDir(): string | undefined {
	const metadata: RunMetadata = {
		version: 1,
		handle: "probe",
		tmuxSession: "pi-subagent-probe",
		runDir: join(scratch, "run"),
		sessionFile: join(scratch, "run", "session.jsonl"),
		cwd: scratch,
		provider: "p",
		model: "m",
		thinking: "low",
		state: "starting",
		hasStarted: false,
		createdAt: "",
		updatedAt: "",
	};
	launchRun(metadata);
	const args = readFileSync(argsLog, "utf8").split("\n");
	// Only the assignments `env` applies before it runs the launcher count.
	const assignments = args.slice(args.indexOf("env") + 1, args.indexOf("--session") - 1);
	return assignments.find((arg) => arg.startsWith("PI_CODING_AGENT_DIR="))?.slice("PI_CODING_AGENT_DIR=".length);
}

test("the child gets ~/.pi/agent when the parent has no PI_CODING_AGENT_DIR", () => {
	assert.equal(launchedAgentDir(), join(scratch, "home", ".pi", "agent"));
});

test("the child gets the parent's PI_CODING_AGENT_DIR", () => {
	process.env.PI_CODING_AGENT_DIR = "/custom/agent";
	assert.equal(launchedAgentDir(), "/custom/agent");
});

test("a ~ or file:// agent dir is expanded the way pi does, for the child and for finding runs", () => {
	process.env.PI_CODING_AGENT_DIR = "~/agent";
	assert.equal(launchedAgentDir(), join(scratch, "home", "agent"));
	assert.equal(getRunsDir(), join(scratch, "home", "agent", "subagents"));
	process.env.PI_CODING_AGENT_DIR = "file:///custom/agent";
	assert.equal(launchedAgentDir(), "/custom/agent");
	assert.equal(getRunsDir(), "/custom/agent/subagents");
});

test("a relative agent dir is refused before tmux runs", () => {
	process.env.PI_CODING_AGENT_DIR = "relative/agent";
	assert.throws(launchedAgentDir, /must be an absolute path/);
	assert.equal(existsSync(argsLog), false);
});

test("subagent spawn refuses a relative agent dir without creating anything", () => {
	const cli = join(dirname(fileURLToPath(import.meta.url)), "subagent.ts");
	const result = spawnSync(process.execPath, [cli, "spawn", "--provider", "p", "--model", "m", "--prompt", "x"], {
		cwd: scratch,
		env: { ...process.env, PI_CODING_AGENT_DIR: "agent", PI_SUBAGENT_RUN_DIR: "" },
		encoding: "utf8",
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /must be an absolute path/);
	assert.equal(existsSync(join(scratch, "agent")), false);
	assert.equal(existsSync(argsLog), false);
});
