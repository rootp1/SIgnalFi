
export interface Position {
  token: string;
  quantity: number;
  entryPrice: number;
}

export interface User {
  following: string[];
  tradeAmount: number;
  openPositions: Position[];
}
