import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDecisionFormatPlan } from "../canonicalCaseGenerator";

function summarize(plan: Map<number, "multiple_choice" | "written">) {
  const mc: number[] = [];
  const written: number[] = [];
  for (const [num, fmt] of plan.entries()) {
    if (fmt === "multiple_choice") mc.push(num);
    else written.push(num);
  }
  mc.sort((a, b) => a - b);
  written.sort((a, b) => a - b);
  return { mc, written };
}

describe("buildDecisionFormatPlan", () => {
  it("legacy default (count=1, mode='first') puts MC at decision 1 only", () => {
    const plan = buildDecisionFormatPlan(5, 1, "first");
    const { mc, written } = summarize(plan);
    assert.deepEqual(mc, [1]);
    assert.deepEqual(written, [2, 3, 4, 5]);
  });

  it("count=0 produces all-written", () => {
    const plan = buildDecisionFormatPlan(4, 0, "first");
    const { mc, written } = summarize(plan);
    assert.deepEqual(mc, []);
    assert.deepEqual(written, [1, 2, 3, 4]);
  });

  it("count=stepCount produces all-MC regardless of mode", () => {
    const planFirst = buildDecisionFormatPlan(4, 4, "first");
    const planRandom = buildDecisionFormatPlan(4, 4, "random");
    assert.deepEqual(summarize(planFirst).mc, [1, 2, 3, 4]);
    assert.deepEqual(summarize(planRandom).mc, [1, 2, 3, 4]);
  });

  it("'first' mode fills positions 1..N consecutively", () => {
    const plan = buildDecisionFormatPlan(6, 3, "first");
    const { mc, written } = summarize(plan);
    assert.deepEqual(mc, [1, 2, 3]);
    assert.deepEqual(written, [4, 5, 6]);
  });

  it("'random' mode reserves the final decision as written when at least one written slot exists", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = buildDecisionFormatPlan(5, 2, "random", seed);
      const { mc, written } = summarize(plan);
      assert.equal(mc.length, 2);
      assert.equal(written.length, 3);
      assert.equal(plan.get(5), "written", `seed=${seed}: final decision should be written`);
    }
  });

  it("'random' mode is deterministic when given the same seed", () => {
    const a = buildDecisionFormatPlan(7, 3, "random", 42);
    const b = buildDecisionFormatPlan(7, 3, "random", 42);
    assert.deepEqual(summarize(a), summarize(b));
  });

  it("clamps mcCount above stepCount and below zero", () => {
    const high = buildDecisionFormatPlan(3, 99, "first");
    const low = buildDecisionFormatPlan(3, -5, "first");
    assert.deepEqual(summarize(high).mc, [1, 2, 3]);
    assert.deepEqual(summarize(low).mc, []);
  });

  it("plan covers exactly stepCount decisions", () => {
    for (const steps of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const plan = buildDecisionFormatPlan(steps, 2, "random", 7);
      assert.equal(plan.size, steps);
      for (let i = 1; i <= steps; i++) {
        assert.ok(plan.has(i), `plan missing decision ${i} for steps=${steps}`);
      }
    }
  });
});
