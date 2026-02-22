import { clusterApiUrl, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

export const SOLANA_NETWORK = 'devnet';
export const SOLANA_ENDPOINT = clusterApiUrl(SOLANA_NETWORK);

export const getConnection = () => new Connection(SOLANA_ENDPOINT, 'confirmed');

export const getBalance = async (publicKey) => {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
};

export const truncateAddress = (address) => {
  if (!address) return '';
  const str = address.toString();
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
};
