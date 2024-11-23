import { assert, test } from "vitest";

import {
  ActionHash,
  encodeHashToBase64,
} from "@holochain/client";
import { runScenario } from "@holochain/tryorama";
import { decode, encode } from "@msgpack/msgpack";

import { getCellByRoleName } from "./common.js";
import {
  CreateThingInput,
  LinkDirection,
  LinkInput,
  linkInputToRustFormat,
  LinkTagContent,
  Thing,
} from "@holochain/simple-holochain";

test("Create a bidirectional link between to Things and verify correctness of the link tag contents", async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = process.cwd() + "/../workdir/generic-dna.happ";

    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Add 2 players with the test app to the Scenario. The returned players
    // can be destructured.
    const [alice, bob] = await scenario.addPlayersWithApps([
      appSource,
      appSource,
    ]);

    // Shortcut peer discovery through gossip and register all agents in every
    // conductor of the scenario.
    await scenario.shareAllAgents();

    const aliceCell = getCellByRoleName(alice, "generic_dna");
    const bobCell = getCellByRoleName(bob, "generic_dna");

    // - Alice creates two Things and a bidirectional link between them

    const thingInput1: CreateThingInput = {
      content: "thing 1",
    };
    const thing1: Thing = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "create_thing",
      payload: thingInput1,
    });

    let linkInput: LinkInput = {
      direction: LinkDirection.Bidirectional,
      node_id: { type: "Thing", id: thing1.id },
      tag: encode("testtag")
    };
    const thingInput2: CreateThingInput = {
      content: "hello",
      links: [linkInputToRustFormat(linkInput)],
    };
    const thing2: Thing = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "create_thing",
      payload: thingInput2,
    });

    // - Check that the link tag contents are properly set
    const linkedThingIds: [ActionHash, LinkTagContent][] = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_linked_thing_ids",
      payload: { type: "Thing", id: thing2.id },
    });

    assert(linkedThingIds.length === 1);
    assert.equal(encodeHashToBase64(linkedThingIds[0][0]), encodeHashToBase64(thing1.id));
    assert(!!linkedThingIds[0][1].backlink_action_hash);
    assert.equal(linkedThingIds[0][1].thing_created_at , thing1.created_at);
    assert.equal(encodeHashToBase64(linkedThingIds[0][1].thing_created_by), encodeHashToBase64(thing1.creator));
    assert.deepEqual(linkedThingIds[0][1].target_node_id, { type: "Thing", id: thing1.id });
    assert.equal(decode(linkedThingIds[0][1].tag), decode(linkInput.tag));

    const linkedThingIds2: [ActionHash, LinkTagContent][] = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_linked_thing_ids",
      payload: { type: "Thing", id: thing1.id },
    });

    assert(linkedThingIds2.length === 1);
    assert.equal(encodeHashToBase64(linkedThingIds2[0][0]), encodeHashToBase64(thing2.id));
    assert(!linkedThingIds2[0][1].backlink_action_hash);
    assert.equal(linkedThingIds2[0][1].thing_created_at , thing2.created_at);
    assert.equal(encodeHashToBase64(linkedThingIds2[0][1].thing_created_by) , encodeHashToBase64(thing2.creator));
    assert.deepEqual(linkedThingIds2[0][1].target_node_id, { type: "Thing", id: thing2.id });
    assert.equal(decode(linkedThingIds2[0][1].tag), decode(linkInput.tag));
  });
});



// TODO test all other combinations of link creation