import {
  ActionHash,
  AppBundleSource,
  fakeActionHash,
  fakeAgentPubKey,
  fakeDnaHash,
  fakeEntryHash,
  hashFrom32AndType,
  NewEntryAction,
  Record,
} from "@holochain/client";
import { CallableCell } from "@holochain/tryorama";

export async function sampleThing(cell: CallableCell, partialThing = {}) {
  return {
    ...{
      content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    },
    ...partialThing,
  };
}

export async function createThing(cell: CallableCell, thing = undefined): Promise<Record> {
  return cell.callZome({
    zome_name: "generic_zome",
    fn_name: "create_thing",
    payload: thing || await sampleThing(cell),
  });
}
