declare module 'munkres-js' {
  /**
   * Munkres (Hungarian) algorithm for optimal assignment
   * @param costMatrix - 2D array where costMatrix[i][j] is the cost of assigning row i to column j
   * @returns Array of [row, col] pairs representing the optimal assignment
   */
  function munkres(costMatrix: number[][]): [number, number][];
  export = munkres;
}
