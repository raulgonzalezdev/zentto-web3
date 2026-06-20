// Verifica la lectura real de eventos Transfer ERC-20 (USDC) en Sepolia.
import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';

const c = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

const current = await c.getBlockNumber();
const from = current - 800n;
const logs = await c.getLogs({
  address: USDC,
  event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
  fromBlock: from,
  toBlock: current,
});
console.log(`Bloque actual: ${current}. Transfers USDC en últimos 800 bloques: ${logs.length}`);
if (logs[0]) {
  console.log(
    `Ejemplo: ${formatUnits(logs[0].args.value, 6)} USDC -> ${logs[0].args.to} (tx ${logs[0].transactionHash.slice(0, 12)}…)`,
  );
}
console.log('OK: el indexer puede leer depósitos reales');
