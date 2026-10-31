import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { launchRun, type RunMetadata } from "./shared.ts";

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

test("a relative or ~ agent dir reaches the child as an absolute path", () => {
	process.env.PI_CODING_AGENT_DIR = "~/agent";
	assert.equal(launchedAgentDir(), join(scratch, "home", "agent"));
	process.env.PI_CODING_AGENT_DIR = "relative/agent";
	assert.equal(launchedAgentDir(), resolve("relative/agent"));
});
