import { CallableCell, Player, PlayerApp } from "@holochain/tryorama";

export function getCellByRoleName(player: PlayerApp, roleName: string): CallableCell {
  const cells = player.cells;
  return cells.find((cell) => cell.name === roleName);
}
