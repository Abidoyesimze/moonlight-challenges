import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

export * from "./managed/payveil/contract/index.js";
export * from "./witnesses";

import * as CompiledPayVeilContract from "./managed/payveil/contract/index.js";
import * as Witnesses from "./witnesses";

export const CompiledPayVeilContractContract = CompiledContract.make<
  CompiledPayVeilContract.Contract<Witnesses.PayVeilPrivateState>
>("PayVeil", CompiledPayVeilContract.Contract<Witnesses.PayVeilPrivateState>).pipe(
  CompiledContract.withWitnesses(Witnesses.witnesses),
  CompiledContract.withCompiledFileAssets("./managed/payveil"),
);
