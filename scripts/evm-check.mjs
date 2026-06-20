// Verificación de conectividad real con Ethereum (Sepolia) vía viem.
import { createPublicClient, http, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';

const c = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const abi = [
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const block = await c.getBlockNumber();
const sym = await c.readContract({ address: USDC, abi, functionName: 'symbol' });
const dec = await c.readContract({ address: USDC, abi, functionName: 'decimals' });
const bal = await c.readContract({ address: USDC, abi, functionName: 'balanceOf', args: [USDC] });
console.log('Sepolia bloque actual:', block.toString());
console.log('Token USDC -> symbol:', sym, '· decimals:', dec);
console.log('balanceOf(ejemplo):', formatUnits(bal, Number(dec)), sym);
console.log('OK: lectura de Ethereum real funcionando');
