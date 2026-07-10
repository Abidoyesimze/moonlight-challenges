/**
 * PayVeil common types and abstractions.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { PayVeilPrivateState, Contract, Witnesses } from '../../contract/src/index';

export const payveilPrivateStateKey = 'payveilPrivateState';
export type PrivateStateId = typeof payveilPrivateStateKey;

/**
 * The private states consumed throughout the application.
 *
 * @public
 */
export type PrivateStates = {
  readonly payveilPrivateState: PayVeilPrivateState;
};

/**
 * Represents a PayVeil contract and its private state.
 *
 * @public
 */
export type PayVeilContract = Contract<PayVeilPrivateState, Witnesses<PayVeilPrivateState>>;

/**
 * The keys of the circuits exported from {@link PayVeilContract}.
 *
 * @public
 */
export type PayVeilCircuitKeys = Exclude<keyof PayVeilContract['impureCircuits'], number | symbol>;

/**
 * The providers required by {@link PayVeilContract}.
 *
 * @public
 */
export type PayVeilProviders = MidnightProviders<PayVeilCircuitKeys, PrivateStateId, PayVeilPrivateState>;

/**
 * A {@link PayVeilContract} that has been deployed to the network.
 *
 * @public
 */
export type DeployedPayVeilContract = FoundContract<PayVeilContract>;

/**
 * The derived combination of public (ledger) state and private state.
 */
export type PayVeilDerivedState = {
  readonly submissionCount: bigint;
  readonly totalSalary: bigint;
  readonly averageSalary: bigint | undefined;

  /**
   * Whether the current private identity has already contributed a salary,
   * derived by hashing the local secret ID and checking it against the
   * public `submitted` nullifier set.
   */
  readonly hasSubmitted: boolean;
};
