export function describeRuntimeAction(action: string): string {
  switch (action) {
    case "depositLpPosition":
      return "add liquidity (LP deposit)";
    case "withdrawLpPosition":
      return "remove liquidity (LP withdraw)";
    case "withdrawToOwner":
      return "withdraw to owner";
    case "sweepToOwner":
      return "sweep to owner";
    case "planUniswapLiquidity":
      return "plan Uniswap liquidity";
    default:
      return action;
  }
}
