import { Ledger } from "./managed/payveil/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/compact-runtime";

export type PayVeilPrivateState = {
  readonly secretId: Uint8Array;
  readonly salary: bigint;
};

export const createPayVeilPrivateState = (
  secretId: Uint8Array,
  salary: bigint,
): PayVeilPrivateState => ({ secretId, salary });

export const witnesses = {
  mySecretId: ({
    privateState,
  }: WitnessContext<Ledger, PayVeilPrivateState>): [
    PayVeilPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretId],

  mySalary: ({
    privateState,
  }: WitnessContext<Ledger, PayVeilPrivateState>): [
    PayVeilPrivateState,
    bigint,
  ] => [privateState, privateState.salary],
};
