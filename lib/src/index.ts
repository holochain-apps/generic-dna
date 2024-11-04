import { ZomeClient } from "@holochain-open-dev/utils";
import {
  ActionHashB64,
  AgentPubKey,
  AgentPubKeyB64,
  AppCallZomeRequest,
  AppClient,
  AppWebsocket,
  AppWebsocketConnectionOptions,
  encodeHashToBase64,
} from "@holochain/client";
import {
  CreateOrDeleteLinksInput,
  CreateThingInput,
  DeleteThingInput,
  GenericZomeSignal,
  LinkDirection,
  LinkDirectionRust,
  LinkInput,
  LinkInputRust,
  NodeContent,
  NodeId,
  Thing,
  ThingId,
  UpdateThingInput,
} from "./types";

export * from "./types";

import {
  derived,
  Readable,
  Unsubscriber,
  Writable,
  writable,
} from "svelte/store";

export type NodeStoreContent = {
  content: NodeContent;
  linkedNodeIds: NodeId[];
};

export type AsyncStatus<T> =
  | { status: "pending" }
  | { status: "complete"; value: T }
  | { status: "error"; error: any };

const DEFAULT_POLLING_FREQUENCY = 10000;
export class NodeStore {
  client: SimpleHolochain;
  nodeId: NodeId;

  private subscribers: number[] = [];
  private nodeStore: Writable<AsyncStatus<NodeStoreContent>> = writable({
    status: "pending",
  });

  private pollInterval: number | undefined;

  constructor(client: SimpleHolochain, nodeId: NodeId) {
    this.client = client;
    this.nodeId = nodeId;
  }

  protected readable(): Readable<AsyncStatus<NodeStoreContent>> {
    return derived(this.nodeStore, (s) => s);
  }

  subscribe(cb: (value: AsyncStatus<NodeStoreContent>) => any): Unsubscriber {
    const subscriberId = this.addSubscriber();

    // TODO listen for signals here

    const unsubscribe = this.nodeStore.subscribe((val) => cb(val));

    if (!this.pollInterval) {
      this.pollStore();
      this.pollInterval = window.setInterval(
        async () => this.pollStore(),
        DEFAULT_POLLING_FREQUENCY
      );
    }

    return () => {
      console.log("@NodeStore: Unsubscribing...");
      this.removeSubscriber(subscriberId);
      if (this.subscribers.length === 0 && this.pollInterval) {
        window.clearInterval(this.pollInterval);
      }
      unsubscribe();
    };
  }

  async pollStore() {
    console.log(
      "Polling in NodeStore. Current subscriber count: ",
      this.subscribers.length
    );

    let linkedNodeIds = await this.client.getAllLinkedNodeIds(this.nodeId);

    if (this.nodeId.type === "Thing") {
      const latestThing = await this.client.getThing(this.nodeId.id);
      if (!latestThing) {
        this.nodeStore.set({
          status: "error",
          error: `Failed to get Thing record for thing with id ${encodeHashToBase64(
            this.nodeId.id
          )}`,
        });
        return;
      }
      const content: NodeContent = {
        type: "Thing",
        content: latestThing,
      };
      this.nodeStore.set({
        status: "complete",
        value: {
          content,
          linkedNodeIds,
        },
      });
    } else if (this.nodeId.type === "Agent") {
      const content: NodeContent = {
        type: "Agent",
        content: this.nodeId.id,
      };
      this.nodeStore.set({
        status: "complete",
        value: {
          content,
          linkedNodeIds,
        },
      });
    } else if (this.nodeId.type === "Anchor") {
      const content: NodeContent = {
        type: "Anchor",
        content: this.nodeId.id,
      };
      this.nodeStore.set({
        status: "complete",
        value: {
          content,
          linkedNodeIds,
        },
      });
    } else {
      throw new Error(`Invalid Node type ${(this.nodeId as any).type}`);
    }
  }

  addSubscriber(): number {
    let id = Math.max(...this.subscribers) + 1;
    this.subscribers = [...this.subscribers, id];
    return id;
  }

  removeSubscriber(id: number) {
    this.subscribers = this.subscribers.filter((s) => s != id);
  }
}

export class SimpleHolochain {
  private client: AppClient;
  private zomeClient: ZomeClient<GenericZomeSignal>;
  private roleName: string;
  private zomeName: string;

  private anchorStores: Record<string, NodeStore> = {};
  private agentStores: Record<AgentPubKeyB64, NodeStore> = {};
  private thingStores: Record<ActionHashB64, NodeStore> = {};

  private constructor(
    client: AppClient,
    zomeClient: ZomeClient<GenericZomeSignal>,
    roleName: string = "generic_dna",
    zomeName: string = "generic_zome"
  ) {
    this.client = client;
    this.zomeClient = zomeClient;
    this.roleName = roleName;
    this.zomeName = zomeName;
    // TODO set up signal listener. Potentially emit signal to conductor
  }

  static async connect(options: AppWebsocketConnectionOptions = {}) {
    const client = await AppWebsocket.connect(options);
    const zomeClient = new ZomeClient<GenericZomeSignal>(
      client,
      "generic_dna",
      "generic_zome"
    );
    return new SimpleHolochain(client, zomeClient);
  }

  nodeStore(nodeId: NodeId): NodeStore {
    switch (nodeId.type) {
      case "Agent": {
        const agentId = encodeHashToBase64(nodeId.id);
        const maybeNodeStore = this.agentStores[agentId];
        if (maybeNodeStore) return maybeNodeStore;
        this.agentStores[agentId] = new NodeStore(this, nodeId);
        return this.agentStores[agentId];
      }
      case "Anchor": {
        const maybeNodeStore = this.anchorStores[nodeId.id];
        if (maybeNodeStore) return maybeNodeStore;
        this.anchorStores[nodeId.id] = new NodeStore(this, nodeId);
        return this.anchorStores[nodeId.id];
      }
      case "Thing": {
        const thingId = encodeHashToBase64(nodeId.id);
        const maybeNodeStore = this.thingStores[thingId];
        if (maybeNodeStore) return maybeNodeStore;
        this.thingStores[thingId] = new NodeStore(this, nodeId);
        return this.thingStores[thingId];
      }
    }
  }

  /**
   * Creates a "Thing", i.e. an arbitrary piece of content in the DHT. You are responsible
   * yourself for making sure that the content adheres to the format you want
   * it to adhere.
   *
   * @param content
   * @param links
   * @returns
   */
  async createThing(content: string, links?: LinkInput[]): Promise<Thing> {
    let input: CreateThingInput = {
      content,
      links: links
        ? links.map((link) => linkInputToRustFormat(link))
        : undefined,
    };
    return this.callZome("create_thing", input);
  }

  /**
   * Update the content of a thing without changing any of
   * the links that point to or from it.
   *
   * @param thingId
   * @param updatedContent
   * @returns
   */
  async updateThing(thingId: ThingId, updatedContent: string): Promise<Thing> {
    let input: UpdateThingInput = {
      thing_id: thingId,
      updated_content: updatedContent,
    };
    return this.callZome("udpate_thing", input);
  }

  /**
   * Deletes a Thing as well as optionally any backlinks of
   * 'bidirectional' links that were created with this Thing
   * as the source. A Thing is unaware of 'from' links
   * pointing to it from elsewhere (including bidirectional links * that were created from another node as the src).
   * Such links (or any other links) need to be explicitly deleted * by passing them with the 'links' argument or using the
   * `deleteLink` function.
   *
   * @param thingId
   * @param deleteBacklinks
   * @param deleteLinksFromCreator
   * @param deleteLinks
   * @returns
   */
  async deleteThing(
    thingId: ThingId,
    deleteBacklinks: boolean,
    deleteLinksFromCreator: boolean,
    deleteLinks?: LinkInput[]
  ): Promise<void> {
    let input: DeleteThingInput = {
      thing_id: thingId,
      delete_backlinks: deleteBacklinks,
      delete_links_from_creator: deleteLinksFromCreator,
      delete_links: deleteLinks
        ? deleteLinks.map((link) => linkInputToRustFormat(link))
        : undefined,
    };
    return this.callZome("delete_thing", input);
  }

  /**
   * Gets the latest known version of a thing (it's possible that other peers
   * have updated it but they are now offline and we don't know about it)
   *
   * @param thingId
   * @returns
   */
  async getThing(thingId: ThingId): Promise<Thing | undefined> {
    return this.callZome("get_latest_thing", thingId);
  }

  /**
   * Gets the latest known version of a thing (it's possible that other peers
   * have updated it but they are now offline and we don't know about it)
   *
   * @param thingId
   * @returns
   */
  async getThings(thingIds: ThingId[]): Promise<(Thing | undefined)[]> {
    return this.callZome("get_latest_things", thingIds);
  }

  /**
   * Get all the node ids that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getAllLinkedNodeIds(src: NodeId): Promise<NodeId[]> {
    return this.callZome("get_all_linked_node_ids", src);
  }

  /**
   * Get all the nodes that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getAllLinkedNodes(src: NodeId): Promise<NodeContent[]> {
    return this.callZome("get_all_linked_nodes", src);
  }

  /**
   * Get all the agents that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedAgents(src: NodeId): Promise<AgentPubKey[]> {
    return this.callZome("get_linked_agents", src);
  }

  /**
   * Get all the anchors that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedAnchors(src: NodeId): Promise<string[]> {
    return this.callZome("get_linked_anchors", src);
  }

  /**
   * Get the latest versions of all Things that are linked from the
   * specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedThings(src: NodeId): Promise<Thing[]> {
    return this.callZome("get_linked_things", src);
  }

  /**
   * Creates links from a specified source node
   *
   * @param src
   * @param links
   * @returns
   */
  async createLinks(src: NodeId, links: LinkInput[]): Promise<void> {
    const input: CreateOrDeleteLinksInput = {
      src,
      links: links.map((link) => linkInputToRustFormat(link)),
    };
    return this.callZome("create_links_from_node", input);
  }

  /**
   * Will delete the specified links.
   * If a tag is provided in the LinkInput, only links
   * with this same tag will be deleted. Otherwise only
   * links without tag will be deleted.
   *
   * @param src
   * @param links
   * @returns
   */
  async deleteLinks(src: NodeId, links: LinkInput[]): Promise<void> {
    const input: CreateOrDeleteLinksInput = {
      src,
      links: links.map((link) => linkInputToRustFormat(link)),
    };
    return this.callZome("delete_links_from_node", input);
  }

  private callZome(fn_name: string, payload: any) {
    const req: AppCallZomeRequest = {
      role_name: this.roleName,
      zome_name: this.zomeName,
      fn_name,
      payload,
    };
    return this.client.callZome(req);
  }
}

function linkInputToRustFormat(linkInput: LinkInput): LinkInputRust {
  let linkDirection: LinkDirectionRust;
  switch (linkInput.direction) {
    case LinkDirection.From:
      linkDirection = {
        type: "From",
      };
    case LinkDirection.To:
      linkDirection = { type: "To" };
    case LinkDirection.Bidirectional:
      linkDirection = { type: "Bidirectional" };
  }
  return {
    direction: linkDirection,
    node_id: linkInput.node_id,
    tag: linkInput.tag,
  };
}
