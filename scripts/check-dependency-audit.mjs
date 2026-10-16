import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const reviewedAdvisories=new Set([
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
]);
const versions={"image-size":"1.2.1",pptxgenjs:"4.0.1"};

/** Fail closed on malformed audit responses, new advisories, other versions, or
 * other dependency paths. This exception records reviewed mitigations; it does
 * not claim the vulnerable upstream versions have been patched. */
export function evaluateAudit(report,lock) {
  if(!report || report.error || report.auditReportVersion!==2 || !report.vulnerabilities || typeof report.vulnerabilities!=="object" || !report.metadata?.vulnerabilities || !lock?.packages) throw new Error("npm audit report or lockfile is incomplete");
  const vulnerabilities=Object.entries(report.vulnerabilities);
  if(vulnerabilities.some(([name,item])=>!item || typeof item!=="object" || item.name!==name || !["info","low","moderate","high","critical"].includes(item.severity) || !Array.isArray(item.via) || !Array.isArray(item.nodes))) throw new Error("npm audit vulnerability record is invalid");
  if(report.metadata.vulnerabilities.total!==vulnerabilities.length) throw new Error("npm audit totals do not match findings");
  const high=vulnerabilities.filter(([,item])=>item && ["high","critical"].includes(item.severity));
  if(high.length!==report.metadata.vulnerabilities.high+report.metadata.vulnerabilities.critical) throw new Error("npm audit severity totals do not match findings");
  const accepted=[];const blocked=[];
  const reviewedVersion=(name,item)=>Array.isArray(item.nodes) && item.nodes.length>0 && item.nodes.every(node=>typeof node==="string" && (node===`node_modules/${name}` || node.endsWith(`/node_modules/${name}`)) && lock.packages[node]?.version===versions[name]);
  const image=report.vulnerabilities["image-size"];
  const imageReviewed=image && reviewedVersion("image-size",image) && Array.isArray(image.via) && image.via.length>0 && image.via.every(advisory=>advisory && typeof advisory==="object" && advisory.name==="image-size" && advisory.dependency==="image-size" && reviewedAdvisories.has(advisory.url));
  for(const [name,item] of high) {
    const allowed=name==="image-size"?imageReviewed:name==="pptxgenjs" && imageReviewed && reviewedVersion(name,item) && Array.isArray(item.via) && item.via.length===1 && item.via[0]==="image-size";
    const entry={name,severity:item.severity,nodes:item.nodes,advisories:Array.isArray(item.via)?item.via.map(advisory=>typeof advisory==="string"?advisory:advisory?.url):[]};
    (allowed?accepted:blocked).push(entry);
  }
  return {ok:blocked.length===0,reviewedExceptions:accepted,blocked,totals:report.metadata.vulnerabilities};
}

export function parseAuditProcess(result) {
  if(result.error || result.signal || ![0,1].includes(result.status)) throw new Error("npm audit did not complete successfully (registry, network or process error)");
  let report;
  try {report=JSON.parse(result.stdout);} catch {throw new Error("npm audit did not return valid JSON");}
  if(report.error) throw new Error("npm audit returned a registry error");
  if(result.status===0 && (report.metadata?.vulnerabilities?.total || 0)>0) throw new Error("npm audit exit status contradicts its findings");
  if(result.status===1 && report.metadata?.vulnerabilities?.total===0) throw new Error("npm audit failed without vulnerability findings");
  return report;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result=spawnSync(process.platform==="win32"?"npm.cmd":"npm",["audit","--omit=dev","--audit-level=low","--json"],{encoding:"utf8",timeout:60_000,maxBuffer:16*1024*1024});
    const assessment=evaluateAudit(parseAuditProcess(result),JSON.parse(fs.readFileSync("package-lock.json","utf8")));
    console.log(JSON.stringify(assessment,null,2));
    if(!assessment.ok) process.exitCode=1;
  } catch(error) {console.error(error instanceof Error?error.message:"Dependency audit failed");process.exitCode=1;}
}
