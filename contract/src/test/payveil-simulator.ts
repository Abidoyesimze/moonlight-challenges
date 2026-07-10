import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
} from "../managed/payveil/contract/index.js";
import {
  type PayVeilPrivateState,
  witnesses,
  createPayVeilPrivateState,
} from "../witnesses.js";

/**
 * Serves as a testbed to exercise the PayVeil contract in tests.
 */
export class PayVeilSimulator {
  readonly contract: Contract<PayVeilPrivateState>;
  circuitContext: CircuitContext<PayVeilPrivateState>;

  constructor(secretId: Uint8Array, salary: bigint) {
    this.contract = new Contract<PayVeilPrivateState>(witnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext(
        createPayVeilPrivateState(secretId, salary),
        "0".repeat(64),
      ),
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  /** Switch to a different private identity (new secret ID and/or salary). */
  public switchUser(secretId: Uint8Array, salary: bigint) {
    this.circuitContext.currentPrivateState = createPayVeilPrivateState(
      secretId,
      salary,
    );
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): PayVeilPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public submitSalary(): Ledger {
    this.circuitContext = this.contract.impureCircuits.submitSalary(
      this.circuitContext,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}
