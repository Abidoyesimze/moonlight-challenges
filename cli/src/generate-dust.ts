// Adapted from midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// import { webcrypto } from 'crypto';

import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Logger } from 'pino';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as rx from 'rxjs';

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const generateDust = async (
  logger: Logger,
  walletSeed: string,
  unshieldedState: UnshieldedWalletState,
  walletFacade: WalletFacade,
) => {
  // waitForSyncedState() requires the dust lane to be perfectly synced
  // (allowedGap=0), which can hang indefinitely for a wallet whose dust
  // progress never reports strictly complete. We only need the dust
  // address here, so use the lighter getAddress() instead.
  const dustAddress = await walletFacade.dust.getAddress();
  const networkId = getNetworkId();
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(walletSeed), networkId);
  const utxos = unshieldedState.availableCoins.filter((coin) => !coin.meta.registeredForDustGeneration);

  const waitForDustBalance = () =>
    rx.firstValueFrom(
      walletFacade.state().pipe(
        // Same rationale as wallet-utils.ts: fail fast if the live-update
        // subscription silently dies, instead of hanging indefinitely.
        rx.timeout({ each: 90_000 }),
        rx.filter((s) => s.dust.balance(new Date()) > 0n),
        rx.map((s) => s.dust.balance(new Date())),
      ),
    );

  if (utxos.length === 0) {
    logger.info('NIGHT UTXOs already registered for dust generation.');
    const currentDustBalance = (await rx.firstValueFrom(walletFacade.state())).dust.balance(new Date());
    if (currentDustBalance > 0n) {
      logger.info(`Dust balance already available: ${currentDustBalance}`);
      return;
    }
    // Dust accrues gradually over time from registered UTXOs; a prior
    // registration may not have produced spendable dust yet.
    logger.info('Dust balance is still 0; waiting for it to accrue...');
    const dustBalance = await waitForDustBalance();
    logger.info(`Dust balance accrued: ${dustBalance}`);
    return;
  }

  logger.info(`Generating dust with ${utxos.length} UTXOs...`);

  const recipe = await walletFacade.registerNightUtxosForDustGeneration(
    utxos,
    unshieldedKeystore.getPublicKey(),
    (payload) => unshieldedKeystore.signData(payload),
    dustAddress,
  );
  const transaction = await walletFacade.finalizeRecipe(recipe);
  const txId = await walletFacade.submitTransaction(transaction);

  const dustBalance = await waitForDustBalance();
  logger.info(`Dust generation transaction submitted with txId: ${txId}`);
  logger.info(`Receiver dust balance after generation: ${dustBalance}`);

  return txId;
};
