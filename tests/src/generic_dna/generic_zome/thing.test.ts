import { assert, test } from "vitest";

import { ActionHash, AgentPubKey, encodeHashToBase64 } from "@holochain/client";
import { AppWithOptions, dhtSync, runScenario } from "@holochain/tryorama";
import { decode, encode } from "@msgpack/msgpack";

import { getCellByRoleName } from "./common.js";
import {
  CreateThingInput,
  DeleteThingInput,
  LinkDirection,
  LinkInput,
  linkInputToRustFormat,
  LinkTagContent,
  NodeContent,
  NodeId,
  Thing,
  UpdateThingInput,
} from "@holochain/simple-holochain";

test("Create Thing and update it twice", async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = process.cwd() + "/../workdir/generic-dna.happ";

    // Set up the app to be installed
    const appSource: AppWithOptions = {
      appBundleSource: { type: "path", value: testAppPath },
    };

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

    // Alice creates a Thing
    const thingInput: CreateThingInput = {
      content: "hello",
    };
    const thing: Thing = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "create_thing",
      payload: thingInput,
    });

    assert.equal(
      encodeHashToBase64(thing.creator),
      encodeHashToBase64(aliceCell.cell_id[1])
    );
    assert.equal(thing.content, thingInput.content);

    // Bob gets the thing
    await dhtSync([alice, bob], aliceCell.cell_id[0]);
    const maybeThing: Thing | undefined = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_latest_thing",
      payload: thing.id,
    });

    assert.equal(
      encodeHashToBase64(maybeThing.creator),
      encodeHashToBase64(aliceCell.cell_id[1])
    );
    assert.equal(maybeThing.content, thingInput.content);

    // Bob updates the thing
    const updateThingInput: UpdateThingInput = {
      thing_id: thing.id,
      updated_content: "good bye",
    };
    const _updatedThing: Thing = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "update_thing",
      payload: updateThingInput,
    });

    // Alice reads the updated thing
    await dhtSync([alice, bob], aliceCell.cell_id[0]);
    const maybeUpdatedThing: Thing | undefined = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_latest_thing",
      payload: thing.id,
    });

    assert.equal(
      encodeHashToBase64(maybeUpdatedThing.creator),
      encodeHashToBase64(aliceCell.cell_id[1])
    );
    assert.equal(maybeUpdatedThing.content, updateThingInput.updated_content);
    assert.equal(maybeUpdatedThing.created_at, maybeThing.created_at);
    assert.equal(maybeUpdatedThing.created_at, thing.created_at);
    assert(!!maybeUpdatedThing.updated_at);

    // Bob updates the thing again
    const updateThingInput2: UpdateThingInput = {
      thing_id: thing.id,
      updated_content: "good bye, but now for real!",
    };
    const _updatedThing2: Thing = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "update_thing",
      payload: updateThingInput2,
    });

    // Alice reads the again updated thing
    await dhtSync([alice, bob], aliceCell.cell_id[0]);
    const maybeUpdatedThing2: Thing | undefined = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_latest_thing",
      payload: thing.id,
    });

    assert.equal(
      encodeHashToBase64(maybeUpdatedThing2.creator),
      encodeHashToBase64(aliceCell.cell_id[1])
    );
    assert.equal(maybeUpdatedThing2.content, updateThingInput2.updated_content);
    assert.equal(maybeUpdatedThing2.created_at, maybeThing.created_at);
    assert.equal(maybeUpdatedThing2.created_at, thing.created_at);
    assert(!!maybeUpdatedThing2.updated_at);
  });
});

test("Create Thing and a bidirectional link from the creator, then delete it and try to retrieve it", async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = process.cwd() + "/../workdir/generic-dna.happ";

    // Set up the app to be installed
    const appSource: AppWithOptions = {
      appBundleSource: { type: "path", value: testAppPath },
    };

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

    // Alice creates a Thing and a bidirectional link to her agent anchor
    const aliceAgentAnchor: NodeId = {
      type: "Agent",
      id: aliceCell.cell_id[1],
    };
    let linkInput: LinkInput = {
      direction: LinkDirection.Bidirectional,
      node_id: aliceAgentAnchor,
      tag: encode("tag content"),
    };
    const thingInput: CreateThingInput = {
      content: "hello",
      links: [linkInputToRustFormat(linkInput)],
    };
    const thing: Thing = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "create_thing",
      payload: thingInput,
    });

    // - Bob checks all links that should have been created as a consequence
    await dhtSync([alice, bob], aliceCell.cell_id[0]);

    // Get the links pointing away from the thing node
    const thingNode: NodeId = { type: "Thing", id: thing.id };
    const linkedAgents: [AgentPubKey, LinkTagContent][] =
      await bobCell.callZome({
        zome_name: "generic_zome",
        fn_name: "get_linked_agents",
        payload: thingNode,
      });
    assert(linkedAgents.length === 1);
    assert.equal(
      encodeHashToBase64(aliceCell.cell_id[1]),
      encodeHashToBase64(linkedAgents[0][0])
    );
    // A backlink action hash should exist pointing to the backlink from the agent anchor to the thing
    assert(!!linkedAgents[0][1].backlink_action_hash);
    assert.deepEqual(linkedAgents[0][1].target_node_id, aliceAgentAnchor);
    assert.deepEqual(decode(linkedAgents[0][1].tag), decode(linkInput.tag));
    assert.isNull(linkedAgents[0][1].thing_created_at);

    const linkedNodesFromThing: NodeContent[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: thingNode,
    });
    assert(linkedNodesFromThing.length === 1);
    assert.deepEqual(linkedNodesFromThing[0], {
      type: "Agent",
      content: aliceCell.cell_id[1],
    });

    // Get the links pointing towards the thing node from the agent anchor
    const linkedNodes: NodeContent[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: aliceAgentAnchor,
    });

    assert(linkedNodes.length === 1);
    const expectedNodeContent: NodeContent = {
      type: "Thing",
      content: thing,
    };
    assert.deepEqual(linkedNodes[0], expectedNodeContent);

    const linkedThings: Thing[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_linked_things",
      payload: aliceAgentAnchor,
    });
    assert(linkedThings.length === 1);
    assert.deepEqual(linkedThings[0], thing);

    const linkedThingIds: [ActionHash, LinkTagContent][] =
      await bobCell.callZome({
        zome_name: "generic_zome",
        fn_name: "get_linked_thing_ids",
        payload: aliceAgentAnchor,
      });
    assert(linkedThingIds.length === 1);
    assert.equal(
      encodeHashToBase64(linkedThingIds[0][0]),
      encodeHashToBase64(thing.id)
    );
    assert(!linkedThingIds[0][1].backlink_action_hash);
    assert.equal(linkedThingIds[0][1].thing_created_at, thing.created_at);
    assert.deepEqual(linkedThingIds[0][1].target_node_id, thingNode);
    assert.equal(decode(linkedThingIds[0][1].tag), decode(linkInput.tag));

    // - Alice deletes the thing and the link to her agent anchor should disappear
    //   since delete_links_from_creator is set to true
    const deleteThingInput: DeleteThingInput = {
      thing_id: thing.id,
      delete_backlinks: true,
      delete_links_from_creator: true,
    };
    await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "delete_thing",
      payload: deleteThingInput,
    });

    // Bob tries to get the linked nodes again
    await dhtSync([alice, bob], aliceCell.cell_id[0]);

    // Get the links pointing away from the thing node. They should still be the same,
    // only links poitning towards it are deleted
    const linkedAgents2: [AgentPubKey, LinkTagContent][] =
      await bobCell.callZome({
        zome_name: "generic_zome",
        fn_name: "get_linked_agents",
        payload: thingNode,
      });
    assert(linkedAgents2.length === 1);

    const linkedNodesFromThing2: NodeContent[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: thingNode,
    });
    assert(linkedNodesFromThing2.length === 1);

    // Get the links pointing towards the thing node from the agent anchor.
    // They should have been deleted now.
    const linkedNodes2: NodeContent[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: aliceAgentAnchor,
    });
    assert(linkedNodes2.length === 0);

    const linkedThings2: Thing[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_linked_things",
      payload: aliceAgentAnchor,
    });
    assert(linkedThings2.length === 0);

    const linkedThingIds2: [ActionHash, LinkTagContent][] =
      await bobCell.callZome({
        zome_name: "generic_zome",
        fn_name: "get_linked_thing_ids",
        payload: aliceAgentAnchor,
      });
    assert(linkedThingIds2.length === 0);
  });
});

test("Create Thing and an anchor, then delete the thing and the anchor link", async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = process.cwd() + "/../workdir/generic-dna.happ";

    // Set up the app to be installed
    const appSource: AppWithOptions = {
      appBundleSource: { type: "path", value: testAppPath },
    };

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

    // Alice creates a Thing and a bidirectional link to her agent anchor
    const allThingsAnchor: NodeId = {
      type: "Anchor",
      id: "ALL_THINGS",
    };
    let linkInput: LinkInput = {
      direction: LinkDirection.From,
      node_id: allThingsAnchor,
    };
    const thingInput: CreateThingInput = {
      content: "hello",
      links: [linkInputToRustFormat(linkInput)],
    };
    const thing: Thing = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "create_thing",
      payload: thingInput,
    });

    const thingNode: NodeId = { type: "Thing", id: thing.id };

    // - Bob tries to get the thing from the anchor
    await dhtSync([alice, bob], aliceCell.cell_id[0]);

    // Get the links pointing towards the thing node from the ALL_THINGS anchor
    const linkedNodes: NodeContent[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: allThingsAnchor,
    });

    assert(linkedNodes.length === 1);
    const expectedNodeContent: NodeContent = {
      type: "Thing",
      content: thing,
    };
    assert.deepEqual(linkedNodes[0], expectedNodeContent);

    const linkedThings: Thing[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_linked_things",
      payload: allThingsAnchor,
    });
    assert(linkedThings.length === 1);
    assert.deepEqual(linkedThings[0], thing);

    const linkedThingIds: [ActionHash, LinkTagContent][] =
      await bobCell.callZome({
        zome_name: "generic_zome",
        fn_name: "get_linked_thing_ids",
        payload: allThingsAnchor,
      });
    assert(linkedThingIds.length === 1);
    assert.equal(
      encodeHashToBase64(linkedThingIds[0][0]),
      encodeHashToBase64(thing.id)
    );
    assert(!linkedThingIds[0][1].backlink_action_hash);
    assert.equal(linkedThingIds[0][1].thing_created_at, thing.created_at);
    assert.deepEqual(linkedThingIds[0][1].target_node_id, thingNode);
    assert.isNull(linkedThingIds[0][1].tag);

    // - Alice deletes the thing and the link to the ALL_THINGS anchor should disappear
    const deleteThingInput: DeleteThingInput = {
      thing_id: thing.id,
      delete_backlinks: false,
      delete_links_from_creator: false,
      delete_links: [linkInputToRustFormat(linkInput)],
    };
    await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "delete_thing",
      payload: deleteThingInput,
    });

    // Bob tries to get the linked nodes again and they should all be zero now
    await dhtSync([alice, bob], aliceCell.cell_id[0]);

    // Get the links pointing towards the thing node from the ALL_THINGS anchor.
    // They should have been deleted now.
    const linkedNodes2: NodeContent[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: allThingsAnchor,
    });
    assert(linkedNodes2.length === 0);

    const linkedThings2: Thing[] = await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_linked_things",
      payload: allThingsAnchor,
    });
    assert(linkedThings2.length === 0);

    const linkedThingIds2: [ActionHash, LinkTagContent][] =
      await bobCell.callZome({
        zome_name: "generic_zome",
        fn_name: "get_linked_thing_ids",
        payload: allThingsAnchor,
      });
    assert(linkedThingIds2.length === 0);
  });
});

test("Create Thing and an anchor, then IMMEDIATELY delete the thing and the anchor link", async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = process.cwd() + "/../workdir/generic-dna.happ";

    // Set up the app to be installed
    const appSource: AppWithOptions = {
      appBundleSource: { type: "path", value: testAppPath },
    };

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

    // Alice creates a Thing and a bidirectional link to her agent anchor
    const allThingsAnchor: NodeId = {
      type: "Anchor",
      id: "ALL_THINGS",
    };
    let linkInput: LinkInput = {
      direction: LinkDirection.From,
      node_id: allThingsAnchor,
    };
    const thingInput: CreateThingInput = {
      content: "hello",
      links: [linkInputToRustFormat(linkInput)],
    };
    const thing: Thing = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "create_thing",
      payload: thingInput,
    });

    // const thingNode: NodeId = { type: "Thing", id: thing.id };

    // IMMEDIATELY have Bob delete it without dht sync to check that deletion works also if the link
    // has only been propagated via remote signals
    const deleteThingInput: DeleteThingInput = {
      thing_id: thing.id,
      delete_backlinks: false,
      delete_links_from_creator: false,
      delete_links: [linkInputToRustFormat(linkInput)],
    };
    await bobCell.callZome({
      zome_name: "generic_zome",
      fn_name: "delete_thing",
      payload: deleteThingInput,
    });

    // - Check that Alice cannot find it anymore
    await dhtSync([alice, bob], aliceCell.cell_id[0]);

    // Get the links pointing towards the thing node from the ALL_THINGS anchor
    const linkedNodes: NodeContent[] = await aliceCell.callZome({
      zome_name: "generic_zome",
      fn_name: "get_all_linked_nodes",
      payload: allThingsAnchor,
    });

    assert(linkedNodes.length === 0);
  });
});
