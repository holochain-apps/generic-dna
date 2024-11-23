import { CallableCell, Player } from "@holochain/tryorama";

export function getCellByRoleName(player: Player, roleName: string): CallableCell {
  const cells = player.cells;
  return cells.find((cell) => cell.name === roleName);
}
