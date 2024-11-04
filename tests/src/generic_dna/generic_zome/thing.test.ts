import { assert, test } from "vitest";

import {
  ActionHash,
  AppBundleSource,
  CreateLink,
  DeleteLink,
  fakeActionHash,
  fakeAgentPubKey,
  fakeEntryHash,
  Link,
  NewEntryAction,
  Record,
  SignedActionHashed,
} from "@holochain/client";
import { CallableCell, dhtSync, runScenario } from "@holochain/tryorama";
import { decode } from "@msgpack/msgpack";

import { createThing, sampleThing } from "./common.js";

test("create Thing", async () => {
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

    // Alice creates a Thing
    const record: Record = await createThing(alice.cells[0]);
    assert.ok(record);
  });
});

test("create and read Thing", async () => {
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

    const sample = await sampleThing(alice.cells[0]);

    // Alice creates a Thing
    const record: Record = await createThing(alice.cells[0], sample);
    assert.ok(record);

    // Wait for the created entry to be propagated to the other node.
    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Bob gets the created Thing
    const createReadOutput: Record = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_original_thing",
      payload: record.signed_action.hashed.hash,
    });
    assert.deepEqual(sample, decode((createReadOutput.entry as any).Present.entry) as any);
  });
});

test("create and update Thing", async () => {
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

    // Alice creates a Thing
    const record: Record = await createThing(alice.cells[0]);
    assert.ok(record);

    const originalActionHash = record.signed_action.hashed.hash;

    // Alice updates the Thing
    let contentUpdate: any = await sampleThing(alice.cells[0]);
    let updateInput = {
      original_thing_hash: originalActionHash,
      previous_thing_hash: originalActionHash,
      updated_thing: contentUpdate,
    };

    let updatedRecord: Record = await alice.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "update_thing",
      payload: updateInput,
    });
    assert.ok(updatedRecord);

    // Wait for the updated entry to be propagated to the other node.
    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Bob gets the updated Thing
    const readUpdatedOutput0: Record = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_latest_thing",
      payload: updatedRecord.signed_action.hashed.hash,
    });
    assert.deepEqual(contentUpdate, decode((readUpdatedOutput0.entry as any).Present.entry) as any);

    // Alice updates the Thing again
    contentUpdate = await sampleThing(alice.cells[0]);
    updateInput = {
      original_thing_hash: originalActionHash,
      previous_thing_hash: updatedRecord.signed_action.hashed.hash,
      updated_thing: contentUpdate,
    };

    updatedRecord = await alice.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "update_thing",
      payload: updateInput,
    });
    assert.ok(updatedRecord);

    // Wait for the updated entry to be propagated to the other node.
    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Bob gets the updated Thing
    const readUpdatedOutput1: Record = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_latest_thing",
      payload: updatedRecord.signed_action.hashed.hash,
    });
    assert.deepEqual(contentUpdate, decode((readUpdatedOutput1.entry as any).Present.entry) as any);

    // Bob gets all the revisions for Thing
    const revisions: Record[] = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_revisions_for_thing",
      payload: originalActionHash,
    });
    assert.equal(revisions.length, 3);
    assert.deepEqual(contentUpdate, decode((revisions[2].entry as any).Present.entry) as any);
  });
});

test("create and delete Thing", async () => {
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

    const sample = await sampleThing(alice.cells[0]);

    // Alice creates a Thing
    const record: Record = await createThing(alice.cells[0], sample);
    assert.ok(record);

    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Alice deletes the Thing
    const deleteActionHash = await alice.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "delete_thing",
      payload: record.signed_action.hashed.hash,
    });
    assert.ok(deleteActionHash);

    // Wait for the entry deletion to be propagated to the other node.
    await dhtSync([alice, bob], alice.cells[0].cell_id[0]);

    // Bob gets the oldest delete for the Thing
    const oldestDeleteForThing: SignedActionHashed = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_oldest_delete_for_thing",
      payload: record.signed_action.hashed.hash,
    });
    assert.ok(oldestDeleteForThing);

    // Bob gets the deletions for the Thing
    const deletesForThing: SignedActionHashed[] = await bob.cells[0].callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_deletes_for_thing",
      payload: record.signed_action.hashed.hash,
    });
    assert.equal(deletesForThing.length, 1);
  });
});
