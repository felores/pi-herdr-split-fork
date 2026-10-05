// Regression: the command must copy the selected branch, not reopen its parent
// or resume an abandoned leaf, and must launch only in the caller's sibling pane.
// Observable boundary: registered command -> saved sessions and Herdr commands.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/split-fork.ts";

async function fixture() {
	const scratch = join(process.cwd(), ".scratchpad");
	await mkdir(scratch, { recursive: true });
	const dir = await mkdtemp(join(scratch, "split-fork-"));
	const session = SessionManager.create(dir, dir);
	const user = session.appendMessage({ role: "user", content: "Selected branch", timestamp: Date.now() });
	const assistant = text => ({
		role: "assistant", content: [{ type: "text", text }], api: "openai-codex-responses",
		provider: "openai-codex", model: "gpt-6.1-sol", stopReason: "stop", timestamp: Date.now(),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	});
	const selectedLeaf = session.appendMessage(assistant("SELECTED_BRANCH"));
	session.branch(user);
	session.appendMessage({ role: "user", content: "Abandoned alternative", timestamp: Date.now() });
	session.appendMessage(assistant("ABANDONED_BRANCH"));
	session.branch(selectedLeaf);
	return { dir, session, selectedLeaf };
}

test("fork the selected branch into one named sibling, preserving the caller and failing safely", async () => {
	const savedEnv = { HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
	try {
		for (const scenario of ["wide-prompt", "narrow-idle", "startup-failure", "label-failure", "prompt-uncertain", "split-uncertain", "wrong-tab", "busy", "pending", "outside-herdr", "unsaved"]) {
			const { dir, session, selectedLeaf } = await fixture();
			try {
				process.env.HERDR_ENV = scenario === "outside-herdr" ? "0" : "1";
				process.env.HERDR_PANE_ID = "caller";
				const original = await readFile(session.getSessionFile(), "utf8");
				const calls = [];
				const notices = [];
				let handler;
				let launchedFile;
				const parent = { pane_id: "caller", workspace_id: "workspace", tab_id: "tab" };
				const child = { ...parent, pane_id: "child", tab_id: scenario === "wrong-tab" ? "other" : parent.tab_id };
				extension({
					registerCommand(name, spec) { assert.equal(name, "split-fork"); handler = spec.handler; },
					getThinkingLevel() { return "high"; },
					async exec(command, args, options) {
						assert.equal(command, "herdr", "no personal helper or Python dependency");
						assert.equal(options.cwd, dir);
						calls.push(args);
						let result;
						const fail = error => ({ code: 1, stdout: "", stderr: error, killed: false });
						if (args[1] === "current") result = { pane: parent };
						else if (args[1] === "layout") result = { layout: { panes: [{ ...parent,
							rect: { width: scenario === "narrow-idle" ? 70 : 170, height: 47 } }] } };
						else if (args[0] === "agent" && args[1] === "list") result = { agents: [{ name: "session-fork" }, { name: "session-fork-2" }] };
						else if (args[1] === "split") {
							if (scenario === "split-uncertain") return fail("socket disconnected");
							result = { pane: child };
						} else if (args[1] === "start") {
							launchedFile = args[args.indexOf("--session") + 1];
							if (scenario === "startup-failure") return fail("agent started but not ready");
							result = { agent: { ...child, name: args[2], agent: "pi", interactive_ready: true } };
						} else if (args[1] === "rename") {
							if (scenario === "label-failure") return fail("label refused");
							result = { pane: { ...child, label: args[3] } };
						} else if (args[1] === "prompt") {
							if (scenario === "prompt-uncertain") return fail("prompt receipt lost");
							result = { submitted: true };
						} else throw new Error(`Unexpected Herdr command: ${args.join(" ")}`);
						return { code: 0, stdout: JSON.stringify({ result }), stderr: "", killed: false };
					},
				});
				const prompt = ["wide-prompt", "prompt-uncertain", "startup-failure", "label-failure"].includes(scenario)
					? 'Read only: preserve "quotes", $variables, and\nnewlines.' : "";
				const context = {
					cwd: dir, model: { provider: "openai-codex", id: "gpt-6.1-sol" },
					sessionManager: scenario === "unsaved"
						? { getSessionFile: () => undefined, getLeafId: () => null } : session,
					isIdle: () => scenario !== "busy", hasPendingMessages: () => scenario === "pending",
					ui: { notify(message, level) { notices.push({ message, level }); } },
				};
				await handler(prompt, context);
				assert.equal(await readFile(session.getSessionFile(), "utf8"), original, scenario);
				assert.equal(session.getLeafId(), selectedLeaf);
				if (["busy", "pending", "outside-herdr", "unsaved"].includes(scenario)) {
					assert.equal(calls.length, 0);
					assert.equal(notices.at(-1).level, "warning");
					continue;
				}
				const splits = calls.filter(args => args[1] === "split");
				assert.equal(splits.length, 1, "never retry an uncertain split");
				assert(splits[0].includes("--no-focus"));
				assert.equal(splits[0][splits[0].indexOf("--pane") + 1], parent.pane_id);
				assert.equal(splits[0][splits[0].indexOf("--cwd") + 1], dir);
				assert.equal(splits[0][splits[0].indexOf("--direction") + 1], scenario === "narrow-idle" ? "down" : "right");
				assert(!calls.some(args => args[1] === "close"), "do not destroy uncertain user work");
				if (["split-uncertain", "wrong-tab"].includes(scenario)) {
					assert(!calls.some(args => args[1] === "start"));
					assert.equal(notices.at(-1).level, "error");
					continue;
				}
				assert.notEqual(launchedFile, session.getSessionFile());
				const fork = SessionManager.open(launchedFile);
				assert.equal(fork.getHeader().parentSession, session.getSessionFile());
				assert.notEqual(fork.getSessionId(), session.getSessionId());
				assert.deepEqual(fork.getBranch().map(e => e.id), session.getBranch().map(e => e.id));
				const start = calls.find(args => args[1] === "start");
				assert.equal(start[2], "session-fork-3", "names must avoid existing agents");
				assert.equal(start[start.indexOf("--pane") + 1], child.pane_id);
				assert.equal(start[start.indexOf("--model") + 1], "openai-codex/gpt-6.1-sol");
				assert.equal(start[start.indexOf("--thinking") + 1], "high");
				assert.equal(start[start.indexOf("--") + 1], "--session");
				assert.equal(start[start.indexOf("--name") + 1], start[2]);
				const renames = calls.filter(args => args[1] === "rename");
				assert.equal(renames.length, scenario === "startup-failure" ? 0 : 1);
				if (renames.length) assert.equal(renames[0][3], start[2]);
				const prompts = calls.filter(args => args[1] === "prompt");
				assert.equal(prompts.length, ["wide-prompt", "prompt-uncertain"].includes(scenario) ? 1 : 0,
					"send once after startup and labeling, never resend uncertain prompts");
				if (prompts.length) assert.equal(prompts[0].at(-1), prompt);
				if (["startup-failure", "label-failure", "prompt-uncertain"].includes(scenario)) {
					assert.equal(notices.at(-1).level, "error");
					assert(notices.at(-1).message.includes(child.pane_id));
				} else assert.equal(notices.at(-1).level, "info");
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		}
	} finally {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
});
