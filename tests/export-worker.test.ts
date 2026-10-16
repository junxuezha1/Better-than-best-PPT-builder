import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { ExportWorkerPool } from "../src/lib/export-worker-pool.ts";
import { auditArtifactSnapshot, normalizeArtifactsIsolated } from "../src/lib/artifact-audit.ts";
import { buildPptxDetailed } from "../src/lib/export-pptx.ts";
import { PptxExportError } from "../src/lib/export-types.ts";
const workerPath = fileURLToPath(new URL("./fixtures/export-worker-fixture.mjs", import.meta.url));
const errorCode = (code: string) => (error: unknown) => error instanceof PptxExportError && error.code === code;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="white"/><text x="60" y="100">Isolated export</text></svg>';

test("CPU-bound child leaves a real HTTP heartbeat responsive", async () => {
  const pool = new ExportWorkerPool({ workerPath, timeoutMs: 3000 });
  const server = http.createServer((_request, response) => response.end("heartbeat"));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const task = pool.run<{pid: number}>({ busyMs: 1000 });
    const port = (server.address() as {port: number}).port;
    const start = performance.now();
    for (let index = 0; index < 3; index++) assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "heartbeat");
    assert.ok(performance.now() - start < 700, "HTTP must finish before child CPU work");
    assert.notEqual((await task).pid, process.pid);
  } finally { pool.close(); server.close(); }
});

test("real SVG raster conversion leaves HTTP and timers responsive", async () => {
  const server=http.createServer((_request,response)=>response.end("ready"));
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const port=(server.address() as {port:number}).port;
  let ticks=0,last=performance.now(),longestGap=0;
  const timer=setInterval(()=>{const now=performance.now();longestGap=Math.max(longestGap,now-last);last=now;ticks++;},20);
  try {
    const complex=svg.replace('</svg>','<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>'+Array.from({length:80},(_,i)=>`<rect x="${i%40*25}" y="${200+Math.floor(i/40)*25}" width="16" height="16" fill="url(#g)"/>`).join("")+'</svg>');
    const job=buildPptxDetailed([complex]);
    for(let i=0;i<3;i++) assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),"ready");
    const result=await job;
    assert.equal(result.warnings.length,80);
    assert.ok(ticks>=3,"timer must continue during actual rendering");
    assert.ok(longestGap<750,`main thread blocked for ${longestGap} ms`);
  } finally {clearInterval(timer);server.close();}
});

test("timed-out child is killed and the next queued job recovers", async () => {
  const pool = new ExportWorkerPool({ workerPath, timeoutMs: 350, maxQueue: 1 });
  try {
    const timedOut = assert.rejects(pool.run({kind: "hang"}), errorCode("EXPORT_TIMEOUT"));
    const recovered = pool.run<{output: string}>({output: "recovered"});
    await timedOut;
    assert.equal((await recovered).output, "recovered");
  } finally { pool.close(); }
});

test("pool bounds global concurrency and queued jobs", async () => {
  const pool = new ExportWorkerPool({workerPath, concurrency: 1, maxQueue: 1, timeoutMs: 3000});
  try {
    const first = pool.run({busyMs: 400});
    const second = pool.run({output: 2});
    assert.deepEqual(pool.state, {active: 1, queued: 1});
    await assert.rejects(pool.run({output: 3}), errorCode("EXPORT_BUSY"));
    await Promise.all([first, second]);
  } finally { pool.close(); }
});

test("running and queued cancellation release capacity; crashed children do not poison the pool", async () => {
  const pool = new ExportWorkerPool({workerPath, timeoutMs: 3000, maxQueue: 1});
  try {
    const active = new AbortController(), queued = new AbortController();
    const first = assert.rejects(pool.run({kind: "hang"}, active.signal), errorCode("EXPORT_CANCELLED"));
    const second = assert.rejects(pool.run({}, queued.signal), errorCode("EXPORT_CANCELLED"));
    queued.abort(); active.abort(); await Promise.all([first, second]);
    await assert.rejects(pool.run({kind: "crash"}), errorCode("EXPORT_FAILED"));
    assert.equal((await pool.run<{output: string}>({output: "next"})).output, "next");
    await assert.rejects(pool.run({}, AbortSignal.abort()), errorCode("EXPORT_CANCELLED"));
  } finally { pool.close(); }
});

test("queue wait has its own deadline", async () => {
  const pool = new ExportWorkerPool({workerPath, timeoutMs: 1500, queueTimeoutMs: 100});
  try {
    const first = pool.run({busyMs: 300});
    await assert.rejects(pool.run({}), errorCode("EXPORT_TIMEOUT"));
    await first;
  } finally { pool.close(); }
});

test("real worker exports native text and audits legacy prose without loading a database", async () => {
  const result = await buildPptxDetailed([svg]);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.nativeTextCount, 1);
  const values = await normalizeArtifactsIsolated([{key:"valid",svg:`Draft follows:\n${svg}`},{key:"invalid",svg:"broken"}]);
  assert.equal(values[0].key, "valid"); assert.match(values[0].svg ?? "", /^<svg/);
  assert.deepEqual(values[1], {key:"invalid",svg:null});
  const unsafe = await normalizeArtifactsIsolated([{key:"file",svg:svg.replace('</svg>','<image width="100" height="100" href="file:///private/secret"/></svg>')}]);
  assert.equal(unsafe[0].svg, null);
});


test("audit applies only unchanged snapshots and never writes after cancellation or operational failure", async () => {
  const input = [{key:"slide",svg}];
  for (const scenario of ["edit", "cancel", "timeout", "valid"] as const) {
    let current = "original", writes = 0;
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const result = auditArtifactSnapshot({
      inputs:input, fingerprint:"original", currentFingerprint:()=>current, alreadyAudited:()=>false,
      normalize:async()=>{ await gate; if(scenario==="timeout") throw new PptxExportError("timeout","EXPORT_TIMEOUT",504); return [{key:"slide",svg:"normalized"}]; },
      apply:values=>{writes++;return values[0].svg;}, unchanged:()=>null, signal:controller.signal,
    });
    if(scenario==="edit") current="edited";
    if(scenario==="cancel") controller.abort();
    release();
    if(scenario==="valid") {assert.equal(await result,"normalized");assert.equal(writes,1);}
    else {await assert.rejects(result,errorCode({edit:"EXPORT_STALE",cancel:"EXPORT_CANCELLED",timeout:"EXPORT_TIMEOUT"}[scenario]));assert.equal(writes,0);}
  }
});
