import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudit, parseAuditProcess } from "../scripts/check-dependency-audit.mjs";

const lock=()=>({packages:{"node_modules/image-size":{version:"1.2.1"},"node_modules/pptxgenjs":{version:"4.0.1"}}});
function report() {
  return {auditReportVersion:2,vulnerabilities:{
    "image-size":{name:"image-size",severity:"high",via:["GHSA-w3rx-r6r6-pgpr","GHSA-5p2g-fcmc-qvqq"].map(id=>({name:"image-size",dependency:"image-size",url:`https://github.com/advisories/${id}`})),nodes:["node_modules/image-size"]},
    pptxgenjs:{name:"pptxgenjs",severity:"high",via:["image-size"],nodes:["node_modules/pptxgenjs"]},
  },metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:2,critical:0,total:2}}};
}

test("audit gate allows only the two reviewed image-size advisories and their pinned PptxGenJS effect",()=>{
  const result=evaluateAudit(report(),lock());assert.equal(result.ok,true);assert.equal(result.reviewedExceptions.length,2);assert.deepEqual(result.blocked,[]);
});

test("new advisories on an otherwise reviewed package are blocked",()=>{
  const data=report();data.vulnerabilities["image-size"].via.push({name:"image-size",dependency:"image-size",url:"https://github.com/advisories/GHSA-new-new-new"});
  const result=evaluateAudit(data,lock());assert.equal(result.ok,false);assert.equal(result.blocked.length,2);
});

test("other package versions and unexpected inherited vulnerabilities are blocked",()=>{
  const versions=lock();versions.packages["node_modules/image-size"].version="2.0.2";
  assert.equal(evaluateAudit(report(),versions).ok,false);
  const data=report();data.vulnerabilities.pptxgenjs.via.push("other-dependency");
  assert.equal(evaluateAudit(data,lock()).ok,false);
  const other=report() as ReturnType<typeof report> & {vulnerabilities:Record<string,unknown>};
  other.vulnerabilities.next={name:"next",severity:"critical",via:[],nodes:["node_modules/next"]};other.metadata.vulnerabilities.critical=1;other.metadata.vulnerabilities.total=3;
  assert.equal(evaluateAudit(other,lock()).ok,false);
});

test("every vulnerable installation must have the exact reviewed version in the lockfile",()=>{
  const data=report();data.vulnerabilities["image-size"].nodes.push("node_modules/pptxgenjs/node_modules/image-size");
  assert.equal(evaluateAudit(data,lock()).ok,false);
  const versions=lock() as {packages:Record<string,{version:string}>};versions.packages["node_modules/pptxgenjs/node_modules/image-size"]={version:"1.2.1"};
  assert.equal(evaluateAudit(data,versions).ok,true);
});

test("network failures, malformed JSON and inconsistent reports never pass the audit gate",()=>{
  for(const result of [{status:1,stdout:'{"error":{"code":"ENETUNREACH"}}'},{status:2,stdout:"{}"},{status:null,signal:"SIGTERM",stdout:"{}"},{status:1,error:new Error("timeout"),stdout:"{}"},{status:1,stdout:"not JSON"},{status:0,stdout:JSON.stringify(report())}]) assert.throws(()=>parseAuditProcess(result));
  const data=report();data.metadata.vulnerabilities.high=1;
  assert.throws(()=>evaluateAudit(data,lock()),/totals/);
  assert.throws(()=>evaluateAudit({},lock()),/incomplete/);
});

test("a successful audit with no vulnerabilities requires no exception",()=>{
  const clean={auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{high:0,critical:0,total:0}}};
  assert.equal(evaluateAudit(parseAuditProcess({status:0,stdout:JSON.stringify(clean)}),lock()).ok,true);
});
