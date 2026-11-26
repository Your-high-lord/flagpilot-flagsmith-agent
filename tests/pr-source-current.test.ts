import test from "node:test";
import assert from "node:assert/strict";
import {assertSourcePullRequestCurrent} from "../src/domain/pr-source-current.js";
const expected={headSha:"a".repeat(40),baseSha:"b".repeat(40)};
test("accepts an open PR with the exact reviewed head and base commits",()=>assert.doesNotThrow(()=>assertSourcePullRequestCurrent(expected,{state:"open",head:{sha:expected.headSha},base:{sha:expected.baseSha}})));
test("rejects a PR closed while waiting for approval",()=>assert.throws(()=>assertSourcePullRequestCurrent(expected,{state:"closed",head:{sha:expected.headSha},base:{sha:expected.baseSha}}),/no longer open/));
test("rejects a head commit changed while waiting for approval",()=>assert.throws(()=>assertSourcePullRequestCurrent(expected,{state:"open",head:{sha:"c".repeat(40)},base:{sha:expected.baseSha}}),/changed after approval/));
test("rejects a base commit changed while waiting for approval",()=>assert.throws(()=>assertSourcePullRequestCurrent(expected,{state:"open",head:{sha:expected.headSha},base:{sha:"c".repeat(40)}}),/changed after approval/));
