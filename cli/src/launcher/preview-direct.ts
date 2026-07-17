// Deploys PayVeil to Preview without going through @midnight-ntwrk/testkit-js's
// docker-compose-managed RemoteTestEnvironment (which starts its own ephemeral
// proof-server container per run). Instead this expects a proof server you
// started yourself, e.g.:
//
//   docker run -p 6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v
//
// Usage: npm run preview-direct

import { WebSocket } from 'ws';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

import { PayVeilAPI, type PayVeilProviders, type PrivateStateId } from '../../../api/src/index';
import { type PayVeilPrivateState } from '../../../contract/src/witnesses.js';
import { createLogger } from '../logger-utils.js';
import { MidnightWalletProvider } from '../midnight-wallet-provider';
import { syncWallet, waitForUnshieldedFunds } from '../wallet-utils';
import { generateDust } from '../generate-dust';
import { randomBytes } from '../../../api/src/utils';
import { getPayVeilLedgerState } from '../index.js';

// @ts-expect-error: needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

setNetworkId('preview');

const envConfiguration: EnvironmentConfiguration = {
  walletNetworkId: 'preview',
  networkId: 'preview',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
  proofServer: 'http://localhost:6300',
};

const logger = await createLogger(`../logs/preview-direct/${new Date().toISOString()}.log`);

// If WALLET_MNEMONIC is set, import that wallet instead of generating a
// fresh random one (useful when you already funded a specific wallet via
// the faucet UI). Never pass real/mainnet-holding seeds this way - this
// script logs the derived master seed and stores private state on disk.
const mnemonic = process.env.WALLET_MNEMONIC;
const seedOverride = process.env.WALLET_SEED;
logger.info(
  mnemonic
    ? 'Importing wallet from WALLET_MNEMONIC for Preview...'
    : seedOverride
      ? 'Importing wallet from WALLET_SEED for Preview...'
      : 'Building a fresh wallet for Preview...',
);
const walletProvider = mnemonic
  ? await MidnightWalletProvider.build(logger, envConfiguration, undefined, mnemonic)
  : await MidnightWalletProvider.build(logger, envConfiguration, seedOverride ?? toHex(randomBytes(32)));
const seed = walletProvider.masterSeedHex;
await walletProvider.start();

logger.info('Requesting funds from the faucet and waiting for balance...');
const unshieldedState = await waitForUnshieldedFunds(logger, walletProvider.wallet, envConfiguration, unshieldedToken(), true);
const nightBalance = unshieldedState.balances[unshieldedToken().raw];
logger.info(`NIGHT balance: ${nightBalance}`);

logger.info('Registering NIGHT UTXOs for DUST generation (needed to pay tx fees)...');
const dustTx = await generateDust(logger, seed, unshieldedState, walletProvider.wallet);
if (dustTx) {
  await syncWallet(logger, walletProvider.wallet);
}

const zkConfigProvider = new NodeZkConfigProvider<'submitSalary'>(
  new URL('../../../contract/src/managed/payveil', import.meta.url).pathname,
);
const providers: PayVeilProviders = {
  privateStateProvider: levelPrivateStateProvider<PrivateStateId, PayVeilPrivateState>({
    privateStateStoreName: 'payveil-private-state-direct',
    signingKeyStoreName: 'payveil-private-state-direct-signing-keys',
    privateStoragePasswordProvider: () => 'PayVeil-Test-2026!',
    accountId: seed,
  }),
  publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
  zkConfigProvider,
  proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
  walletProvider,
  midnightProvider: walletProvider,
};

logger.info('Deploying PayVeil contract to Preview...');
const api = await PayVeilAPI.deploy(providers, logger);
logger.info(`✅ Deployed contract at address: ${api.deployedContractAddress}`);

const ledgerState = await getPayVeilLedgerState(providers, api.deployedContractAddress);
logger.info(`Ledger state right after deploy: ${JSON.stringify(ledgerState)}`);

await walletProvider.stop();
logger.info('Done.');
process.exit(0);
