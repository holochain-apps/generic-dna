import { assert, test } from "vitest";

import {
  ActionHash,
  AppBundleSource,
  CreateLink,
  DeleteLink,
  fakeActionHash,
  fakeAgentPubKey,
  fakeEntryHash,
  hashFrom32AndType,
  Link,
  NewEntryAction,
  Record,
  SignedActionHashed,
} from "@holochain/client";
import { CallableCell, dhtSync, runScenario } from "@holochain/tryorama";
import { decode } from "@msgpack/msgpack";

import { createThing } from "./common.js";

test("link a Thing to a Agent", async () => {
  await runScenario(async scenario => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = process.cwd() + "/../workdir/generic-dna.happ";

    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Add 2 players with the test app to the Scenario. The returned players
    // can be destructured.
    const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);

    // Shortcut peer discovery through gossip and register all agents in every
    // conductor of the scenario.
    await scenario.shareAllAgents();

    const baseRecord = await createThing(alice.cells[0]);
    const baseAddress = baseRecord.signed_action.hashed.hash;
    const targetAddress = alice.agentPubKey;

    // Bob gets the links, should be empty
    let linksOutput: Link[] = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_agents_for_thing",
      payload: baseAddress,
    });
    assert.equal(linksOutput.length, 0);

    // Alice creates a link from Thing to Agent
    await alice.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "add_agent_for_thing",
      payload: {
        base_thing_hash: baseAddress,
        target_agent: targetAddress,
      },
    });

    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Bob gets the links again
    linksOutput = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_agents_for_thing",
      payload: baseAddress,
    });
    assert.equal(linksOutput.length, 1);

    await alice.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "delete_agent_for_thing",
      payload: {
        base_thing_hash: baseAddress,
        target_agent: targetAddress,
      },
    });

    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Bob gets the links again
    linksOutput = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_agents_for_thing",
      payload: baseAddress,
    });
    assert.equal(linksOutput.length, 0);

    // Bob gets the deleted links
    let deletedLinksOutput: Array<[SignedActionHashed<CreateLink>, SignedActionHashed<DeleteLink>[]]> = await bob
      .cells[0].callZome({
        zome_name: "generic_zome",
        fn_name: "get_deleted_agents_for_thing",
        payload: baseAddress,
      });
    assert.equal(deletedLinksOutput.length, 1);
  });
});
