import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resultObject(stdout: string): Record<string, unknown> {
	const response: unknown = JSON.parse(stdout);
	if (!record(response) || !record(response.result)) throw new Error("Herdr returned an invalid result.");
	return response.result;
}

type Pane = { pane_id: string; workspace_id: string; tab_id: string };

function paneFromResult(stdout: string): Pane {
	const pane = resultObject(stdout).pane;
	if (!record(pane) || typeof pane.pane_id !== "string" ||
		typeof pane.workspace_id !== "string" || typeof pane.tab_id !== "string") {
		throw new Error("Herdr did not return a pane with workspace and tab identity.");
	}
	return { pane_id: pane.pane_id, workspace_id: pane.workspace_id, tab_id: pane.tab_id };
}

async function run(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<string> {
	const result = await pi.exec("herdr", args, { cwd: ctx.cwd, timeout: 60000 });
	if (result.code !== 0 || result.killed) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || "Herdr command failed.");
	}
	return result.stdout;
}

function splitDirection(stdout: string, paneId: string): "right" | "down" {
	const layout = resultObject(stdout).layout;
	if (!record(layout) || !Array.isArray(layout.panes)) throw new Error("Herdr returned an invalid layout.");
	const pane = layout.panes.find((value: unknown) => record(value) && value.pane_id === paneId);
	if (!record(pane) || !record(pane.rect) || typeof pane.rect.width !== "number" ||
		typeof pane.rect.height !== "number" || pane.rect.width <= 0 || pane.rect.height <= 0) {
		throw new Error("Could not determine the calling pane's dimensions.");
	}
	return pane.rect.width >= pane.rect.height * 2 ? "right" : "down";
}

function availableName(stdout: string): string {
	const agents = resultObject(stdout).agents;
	if (!Array.isArray(agents) || !agents.every(record)) throw new Error("Herdr returned an invalid agent list.");
	const taken = new Set(agents.map(agent => agent.name));
	for (let suffix = 1; suffix <= taken.size + 1; suffix++) {
		const name = suffix === 1 ? "session-fork" : `session-fork-${suffix}`;
		if (!taken.has(name)) return name;
	}
	throw new Error("Could not allocate a unique session-fork name.");
}

export default function herdrSplitFork(pi: ExtensionAPI): void {
	let launching = false;
	pi.registerCommand("split-fork", {
		description: "Copy this conversation into a sibling Herdr pane. Usage: /split-fork [optional prompt]",
		handler: async (args, ctx) => {
			if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
				ctx.ui.notify("/split-fork requires a Herdr-managed pane.", "warning");
				return;
			}
			if (launching) {
				ctx.ui.notify("A split-fork launch is already in progress.", "warning");
				return;
			}
			if (!ctx.isIdle() || ctx.hasPendingMessages()) {
				ctx.ui.notify("Wait for the current turn and queued messages to finish before /split-fork.", "warning");
				return;
			}
			const sessionFile = ctx.sessionManager.getSessionFile();
			const leafId = ctx.sessionManager.getLeafId();
			if (!sessionFile || !leafId) {
				ctx.ui.notify("This session has no saved conversation to fork.", "warning");
				return;
			}

			launching = true;
			let newPaneId: string | undefined;
			let forkFile: string | undefined;
			let stage = "preparing the fork";
			try {
				await access(sessionFile);
				const parent = paneFromResult(await run(pi, ctx, ["pane", "current", "--pane", process.env.HERDR_PANE_ID]));
				const direction = splitDirection(await run(pi, ctx, ["pane", "layout", "--pane", parent.pane_id]), parent.pane_id);
				const name = availableName(await run(pi, ctx, ["agent", "list"]));
				const model = ctx.model;
				const thinking = pi.getThinkingLevel();
				// Use a separate manager so copying the branch never switches the caller's session.
				forkFile = SessionManager.open(sessionFile, undefined, ctx.cwd).createBranchedSession(leafId);
				if (!forkFile || forkFile === sessionFile) throw new Error("Pi did not create a separate fork file.");
				await access(forkFile);

				stage = "splitting the pane";
				const splitOutput = await run(pi, ctx, [
					"pane", "split", "--pane", parent.pane_id, "--direction", direction,
					"--cwd", ctx.cwd, "--no-focus",
				]);
				// Capture ownership before validating the rest of the receipt, for recovery reporting.
				const rawPane = resultObject(splitOutput).pane;
				if (record(rawPane) && typeof rawPane.pane_id === "string") newPaneId = rawPane.pane_id;
				const child = paneFromResult(splitOutput);
				if (child.workspace_id !== parent.workspace_id || child.tab_id !== parent.tab_id ||
					child.pane_id === parent.pane_id) {
					throw new Error("The new pane is not a sibling in the calling workspace and tab.");
				}

				stage = "starting Pi";
				const nativeArgs = ["--session", forkFile, "--name", name];
				if (model) nativeArgs.push("--model", `${model.provider}/${model.id}`);
				nativeArgs.push("--thinking", thinking);
				const agent = resultObject(await run(pi, ctx, [
					"agent", "start", name, "--kind", "pi", "--pane", child.pane_id, "--", ...nativeArgs,
				])).agent;
				if (!record(agent) || agent.pane_id !== child.pane_id || agent.name !== name ||
					agent.agent !== "pi" || agent.interactive_ready !== true) {
					throw new Error("Herdr did not confirm the expected Pi agent is ready.");
				}
				stage = "labeling the pane";
				await run(pi, ctx, ["pane", "rename", child.pane_id, name]);

				const prompt = args.trim();
				if (prompt) {
					stage = "submitting the optional prompt";
					await run(pi, ctx, ["agent", "prompt", child.pane_id, prompt]);
				}
				ctx.ui.notify(
					`Fork opened ${direction} in ${child.pane_id} (${name}). Focus stays here.` +
					(prompt ? " Prompt submitted; completion is not monitored." : " The fork is ready for input.") +
					" Both sessions share the working directory.",
					"info",
				);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const recovery = newPaneId
					? ` Pane ${newPaneId} was retained; inspect it before retrying. Nothing was automatically closed or resent.`
					: stage === "splitting the pane"
						? " The split outcome is uncertain; inspect the calling tab before retrying."
						: " No pane was created.";
				ctx.ui.notify(`Split-fork failed while ${stage}: ${detail}${recovery}` +
					(forkFile ? ` Fork file: ${forkFile}` : ""), "error");
			} finally {
				launching = false;
			}
		},
	});
}
