import test from "node:test";import assert from "node:assert/strict";import {asNumericId,collectRecords,findVariant,parseCliJson} from "../src/flagsmith/cli.js";
test("CLI JSON parses",()=>assert.deepEqual(parseCliJson('{"id":12}'),{id:12}));
test("CLI JSON tolerates leading status text",()=>assert.deepEqual(parseCliJson('info: loaded\n{"id":12}'),{id:12}));
test("nested variation found by key",()=>{const d={feature:{id:2,multivariate_options:[{id:9,key:"treatment",value:"Try it"}]}};assert.equal(collectRecords(d).length,3);assert.equal(findVariant(d,"treatment")?.id,9);});
test("invalid IDs rejected",()=>assert.throws(()=>asNumericId("abc","feature"),/valid feature ID/));
