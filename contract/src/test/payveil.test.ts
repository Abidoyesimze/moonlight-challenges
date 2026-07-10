import { PayVeilSimulator } from "./payveil-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";

setNetworkId("undeployed");

describe("PayVeil smart contract", () => {
  it("initializes public ledger state deterministically", () => {
    const id = randomBytes(32);
    const s0 = new PayVeilSimulator(id, 50000n);
    const s1 = new PayVeilSimulator(id, 50000n);
    // `submitted` is a Set wrapper with live method closures, so compare the
    // plain fields individually rather than deep-equating the whole ledger.
    expect(s0.getLedger().submissionCount).toEqual(s1.getLedger().submissionCount);
    expect(s0.getLedger().totalSalary).toEqual(s1.getLedger().totalSalary);
    expect(s0.getLedger().submissionCount).toEqual(0n);
    expect(s0.getLedger().totalSalary).toEqual(0n);
    expect(s0.getLedger().submitted.isEmpty()).toEqual(true);
  });

  it("lets a user submit a salary, updating only the public aggregate", () => {
    const simulator = new PayVeilSimulator(randomBytes(32), 75000n);
    const initialPrivateState = simulator.getPrivateState();
    simulator.submitSalary();

    // Private state (the raw salary) never changes as a side effect.
    expect(simulator.getPrivateState()).toEqual(initialPrivateState);

    const ledgerState = simulator.getLedger();
    expect(ledgerState.submissionCount).toEqual(1n);
    expect(ledgerState.totalSalary).toEqual(75000n);
    expect(ledgerState.submitted.size()).toEqual(1n);
  });

  it("accumulates the total across multiple distinct users", () => {
    const simulator = new PayVeilSimulator(randomBytes(32), 60000n);
    simulator.submitSalary();
    simulator.switchUser(randomBytes(32), 90000n);
    simulator.submitSalary();
    simulator.switchUser(randomBytes(32), 45000n);
    simulator.submitSalary();

    const ledgerState = simulator.getLedger();
    expect(ledgerState.submissionCount).toEqual(3n);
    expect(ledgerState.totalSalary).toEqual(195000n);
  });

  it("rejects a second submission from the same private identity", () => {
    const id = randomBytes(32);
    const simulator = new PayVeilSimulator(id, 80000n);
    simulator.submitSalary();
    expect(() => simulator.submitSalary()).toThrow(
      "failed assert: You have already submitted a salary",
    );
    // The rejected attempt must not have changed the public totals.
    expect(simulator.getLedger().submissionCount).toEqual(1n);
    expect(simulator.getLedger().totalSalary).toEqual(80000n);
  });

  it("rejects a zero salary", () => {
    const simulator = new PayVeilSimulator(randomBytes(32), 0n);
    expect(() => simulator.submitSalary()).toThrow(
      "failed assert: Salary must be greater than zero",
    );
  });

  it("rejects a salary above the sanity bound", () => {
    const simulator = new PayVeilSimulator(randomBytes(32), 100000000n);
    expect(() => simulator.submitSalary()).toThrow(
      "failed assert: Salary exceeds sanity bound",
    );
  });
});
