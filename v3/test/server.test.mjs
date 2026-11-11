// The local server's chat relay: a message from the page becomes a job for the worker, and the worker's reply lands in the chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("server: chat → job → reply, and a new playbook must exist before it is announced", async (t) => {
  const srv = spawn(process.execPath, [new URL("../server.js", import.meta.url).pathname], { env: { ...process.env, PORT: "0", SIMXP_AUDIO: "off" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => srv.kill());
  const base = await new Promise((res, rej) => {
    let out = ""; srv.stdout.on("data", (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) res(`http://127.0.0.1:${m[1]}`); });
    srv.on("exit", (c) => rej(new Error("server exited " + c))); setTimeout(() => rej(new Error("server did not start")), 20000);
  });
  const get = async (p) => (await fetch(base + p)).json();
  const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };

  assert.equal((await get("/api/health")).ok, true);
  assert.equal((await fetch(base + "/")).status, 200, "the page is served at /");
  assert.equal((await fetch(base + "/playbooks/index.json")).status, 200);

  assert.equal((await post("/api/chat", { thread: "new", text: "a cache stampede" })).status, 200);
  const { job } = await get("/api/jobs/next?timeout=2");
  assert.ok(job && job.thread === "new" && job.playbook === null && job.messages[0].text === "a cache stampede");
  assert.equal((await post("/api/jobs/progress", { job_id: job.id, text: "Writing…" })).status, 200);
  assert.equal((await post("/api/jobs/complete", { job_id: job.id, playbook: "no-such-playbook", reply: "x" })).status, 400, "a new playbook's file must exist");
  assert.equal((await post("/api/jobs/release", { job_id: job.id })).status, 200);

  const again = (await get("/api/jobs/next?timeout=2")).job;
  assert.equal(again.messages[0].text, "a cache stampede", "a released job comes back");
  // a change to an existing playbook: its own thread, with the file named
  await post("/api/jobs/release", { job_id: again.id });
  const pid = "kafka-rebalance-storm";
  assert.equal((await post("/api/chat", { thread: pid, text: "sharper spike" })).status, 200);
  assert.equal((await post("/api/chat", { thread: "nope-not-here", text: "x" })).status, 404);
  let j = (await get("/api/jobs/next?timeout=2")).job;
  if (j.thread === "new") { await post("/api/jobs/complete", { job_id: j.id, playbook: pid, reply: "(test)" }); j = (await get("/api/jobs/next?timeout=2")).job; }
  assert.equal(j.thread, pid); assert.ok(j.file.endsWith(`/playbooks/${pid}.json`));
  assert.equal((await post("/api/jobs/complete", { job_id: j.id, reply: "Done." })).status, 200);
  const chat = await get(`/api/chat?thread=${pid}`);
  assert.equal(chat.messages.at(-1).text, "Done.");
  assert.equal(chat.messages.filter((m) => m.text === "sharper spike").length, 1, "a message is listed once");

  // a worker that dies mid-job: its job goes to the next poll instead of blocking the queue
  await post("/api/chat", { thread: pid, text: "one more key moment" });
  const lost = (await get("/api/jobs/next?timeout=2")).job;
  assert.ok((await get(`/api/chat?thread=${pid}`)).busy);
  const back = (await get("/api/jobs/next?timeout=2")).job;
  assert.equal(back && back.id, lost.id, "a new poll picks up the job the old worker left");
  // Stop from the browser drops it; a late reply from the old worker is refused
  assert.equal((await post("/api/jobs/cancel", { thread: pid })).status, 200);
  const after = await get(`/api/chat?thread=${pid}`);
  assert.equal(after.busy, false); assert.equal(after.messages.at(-1).text, "Stopped.");
  assert.equal((await post("/api/jobs/complete", { job_id: lost.id, reply: "late" })).status, 409);
  // and the queue moves on
  await post("/api/chat", { thread: pid, text: "next" });
  assert.equal((await get("/api/jobs/next?timeout=2")).job.messages[0].text, "next");
});
