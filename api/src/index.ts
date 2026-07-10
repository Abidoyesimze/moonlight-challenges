/**
 * Provides types and utilities for working with PayVeil contracts.
 *
 * @packageDocumentation
 */

import * as PayVeil from '../../contract/src/managed/payveil/contract/index.js';

import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import {
  type PayVeilDerivedState,
  type PayVeilContract,
  type PayVeilProviders,
  type DeployedPayVeilContract,
  payveilPrivateStateKey,
} from './common-types.js';
import { CompiledPayVeilContractContract } from '../../contract/src/index';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, type Observable } from 'rxjs';
import { PayVeilPrivateState, createPayVeilPrivateState } from '../../contract/src/witnesses.js';

/**
 * An API for a deployed PayVeil contract.
 */
export interface DeployedPayVeilAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<PayVeilDerivedState>;

  submitSalary: (salary: bigint) => Promise<void>;
}

/**
 * Provides an implementation of {@link DeployedPayVeilAPI} by adapting a deployed PayVeil contract.
 *
 * @remarks
 * `PayVeilPrivateState` holds a persistent `secretId` (which anonymously and consistently
 * identifies "this local wallet" to the contract, so it can be prevented from submitting twice)
 * and a `salary`, which is only ever set locally, immediately before a `submitSalary` call, and
 * is never persisted or transmitted anywhere in raw form.
 */
export class PayVeilAPI implements DeployedPayVeilAPI {
  /** @internal */
  private constructor(
    public readonly deployedContract: DeployedPayVeilContract,
    private readonly providers: PayVeilProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.state$ = combineLatest(
      [
        // Combine public (ledger) state with...
        providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
          map((contractState) => PayVeil.ledger(contractState.data)),
          tap((ledgerState) =>
            logger?.trace({
              ledgerStateChanged: {
                ledgerState: {
                  submissionCount: ledgerState.submissionCount,
                  totalSalary: ledgerState.totalSalary,
                },
              },
            }),
          ),
        ),
        // ...private state...
        from(providers.privateStateProvider.get(payveilPrivateStateKey) as Promise<PayVeilPrivateState>),
      ],
      // ...and combine them to produce the required derived state.
      (ledgerState, privateState) => {
        const nullifier = PayVeil.pureCircuits.nullifierFor(privateState.secretId);

        return {
          submissionCount: ledgerState.submissionCount,
          totalSalary: ledgerState.totalSalary,
          averageSalary: ledgerState.submissionCount > 0n ? ledgerState.totalSalary / ledgerState.submissionCount : undefined,
          hasSubmitted: ledgerState.submitted.member(nullifier),
        };
      },
    );
  }

  /**
   * Gets the address of the current deployed contract.
   */
  readonly deployedContractAddress: ContractAddress;

  /**
   * Gets an observable stream of state changes based on the current public (ledger),
   * and private state data.
   */
  readonly state$: Observable<PayVeilDerivedState>;

  /**
   * Submits a salary to the benchmarking pool.
   *
   * @param salary The caller's raw salary value. This is stored locally as private state and
   * passed into the circuit as a witness - it is never disclosed on its own. Only the *updated
   * running total* (`totalSalary`) is written to the public ledger.
   *
   * @remarks
   * This method can fail during local circuit execution if this identity has already submitted,
   * or if the salary is zero or exceeds the contract's sanity bound.
   */
  async submitSalary(salary: bigint): Promise<void> {
    this.logger?.info('submittingSalary');

    const existing = (await this.providers.privateStateProvider.get(payveilPrivateStateKey)) as
      | PayVeilPrivateState
      | null;
    const secretId = existing?.secretId ?? utils.randomBytes(32);
    await this.providers.privateStateProvider.set(payveilPrivateStateKey, createPayVeilPrivateState(secretId, salary));

    const txData = await this.deployedContract.callTx.submitSalary();

    this.logger?.trace({
      transactionAdded: {
        circuit: 'submitSalary',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Deploys a new PayVeil contract to the network.
   *
   * @param providers The PayVeil providers.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link PayVeilAPI} instance that manages the newly deployed
   * {@link DeployedPayVeilContract}; or rejects with a deployment error.
   */
  static async deploy(providers: PayVeilProviders, logger?: Logger): Promise<PayVeilAPI> {
    logger?.info('deployContract');

    const deployedPayVeilContract = await deployContract(providers, {
      compiledContract: CompiledPayVeilContractContract,
      privateStateId: payveilPrivateStateKey,
      initialPrivateState: createPayVeilPrivateState(utils.randomBytes(32), 0n),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedPayVeilContract.deployTxData.public,
      },
    });

    return new PayVeilAPI(deployedPayVeilContract, providers, logger);
  }

  /**
   * Finds an already deployed PayVeil contract on the network, and joins it.
   *
   * @param providers The PayVeil providers.
   * @param contractAddress The contract address of the deployed PayVeil contract to search for and join.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link PayVeilAPI} instance that manages the joined
   * {@link DeployedPayVeilContract}; or rejects with an error.
   */
  static async join(providers: PayVeilProviders, contractAddress: ContractAddress, logger?: Logger): Promise<PayVeilAPI> {
    logger?.info({
      joinContract: {
        contractAddress,
      },
    });

    const deployedPayVeilContract = await findDeployedContract<PayVeilContract>(providers, {
      contractAddress,
      compiledContract: CompiledPayVeilContractContract,
      privateStateId: payveilPrivateStateKey,
      initialPrivateState: await PayVeilAPI.getPrivateState(providers, contractAddress),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedPayVeilContract.deployTxData.public,
      },
    });

    return new PayVeilAPI(deployedPayVeilContract, providers, logger);
  }

  private static async getPrivateState(
    providers: PayVeilProviders,
    contractAddress: ContractAddress,
  ): Promise<PayVeilPrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existingPrivateState = await providers.privateStateProvider.get(payveilPrivateStateKey);
    return existingPrivateState ?? createPayVeilPrivateState(utils.randomBytes(32), 0n);
  }
}

/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
