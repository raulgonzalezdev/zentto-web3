// Busca un RPC público de Sepolia que permita eth_getLogs en un rango reciente.
import { createPublicClient, http, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const RPCS = [
  'https://rpc.sepolia.org',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
  'https://ethereum-sepolia.publicnode.com',
  'https://endpoints.omniatech.io/v1/eth/sepolia/public',
];

for (const url of RPCS) {
  try {
    const c = createPublicClient({ chain: sepolia, transport: http(url) });
    const current = await c.getBlockNumber();
    const logs = await c.getLogs({
      address: USDC,
      event: EVENT,
      fromBlock: current - 50n,
      toBlock: current,
    });
    console.log(`OK  ${url}  -> getLogs(50 bloques) = ${logs.length} transfers`);
  } catch (e) {
    console.log(`NO  ${url}  -> ${String(e.shortMessage || e.message).split('\n')[0]}`);
  }
}
