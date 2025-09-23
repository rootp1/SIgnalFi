
import { User } from '../types';

// Create an in-memory Map to act as a mock database
export const userDatabase = new Map<number, User>();

// Create and export a simple object to simulate live token prices
export const mockPrices: { [key: string]: number } = {
  'APT': 8.50,
  'SUI': 1.25,
  'BTC': 65000,
};
