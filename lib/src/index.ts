import { ZomeClient } from "@holochain-open-dev/utils";
import {
  ActionHashB64,
  AgentPubKey,
  AgentPubKeyB64,
  AnyDhtHash,
  AppCallZomeRequest,
  AppClient,
  AppWebsocket,
  AppWebsocketConnectionOptions,
  encodeHashToBase64,
  Record as HolochainRecord,
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
  NodeAndLinkedIds,
  NodeContent,
  NodeId,
  NodeIdAndTag,
  NodeLink,
  RemoteSignalInput,
  Tag,
  Thing,
  ThingId,
  UpdateThingInput,
} from "./types";

export * from "./types";

import {
  derived,
  get,
  Readable,
  Unsubscriber,
  Writable,
  writable,
} from "svelte/store";

declare global {
  interface Window {
    __SIMPLE_PEER_POLL_INTERVAL__: number | undefined;
    __SIMPLE_HOLOCHAIN__: SimpleHolochain;
  }
}

export type NodeStoreContent = {
  content: NodeContent;
  linkedNodeIds: NodeIdAndTag[];
};

export type AsyncStatus<T> =
  | { status: "pending" }
  | { status: "complete"; value: T }
  | { status: "error"; error: any };

const DEFAULT_POLLING_PERIOD = 10000;

export class NodeStore {
  private client: SimpleHolochain;
  public nodeId: NodeId;

  private subscribers: number[] = [];

  nodeStore: Writable<AsyncStatus<NodeStoreContent>> = writable({
    status: "pending",
  });

  constructor(client: SimpleHolochain, nodeId: NodeId) {
    this.client = client;
    this.nodeId = nodeId;
  }

  protected readable(): Readable<AsyncStatus<NodeStoreContent>> {
    return derived(this.nodeStore, (s) => s);
  }

  subscribe(cb: (value: AsyncStatus<NodeStoreContent>) => any): Unsubscriber {
    const firstSubscriber = !this.isSubscribed;

    const subscriberId = this.addSubscriber();

    const unsubscribe = this.nodeStore.subscribe((val) => cb(val));

    if (firstSubscriber) {
      setTimeout(this.pollStore);
    }

    return () => {
      console.log("@NodeStore: Unsubscribing...");
      this.removeSubscriber(subscriberId);
      unsubscribe();
    };
  }

  get isSubscribed() {
    return this.subscribers.length > 0;
  }

  addSubscriber(): number {
    let id = Math.max(...this.subscribers) + 1;
    this.subscribers = [...this.subscribers, id];
    return id;
  }

  removeSubscriber(id: number) {
    this.subscribers = this.subscribers.filter((s) => s != id);
  }

  pollStore = async () => {
    console.log(
      "Polling in NodeStore. Current subscriber count: ",
      this.subscribers.length
    );

    let linkedNodeIds = await this.client.getAllLinkedNodeIds(this.nodeId);
    console.log("@pollStore: Linked node ids: ", linkedNodeIds);

    if (this.nodeId.type === "Thing") {
      const latestThing = await this.client.getThing(this.nodeId.id);
      if (!latestThing) {
        const currentThing = get(this.nodeStore);
        // If it is already complete, we assume that the Thing arrived through emit_signal
        // otherwise we set it to "error"
        if (currentThing.status !== "complete") {
          this.nodeStore.set({
            status: "error",
            error: `Failed to get Thing record for thing with id ${encodeHashToBase64(
              this.nodeId.id
            )}`,
          });
        }
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
  };
}

export class SimpleHolochain {
  private client: AppClient;
  private zomeClient: ZomeClient<GenericZomeSignal>;
  private roleName: string;
  private zomeName: string;

  private anchorStores: Record<string, NodeStore> = {};
  private agentStores: Record<AgentPubKeyB64, NodeStore> = {};
  private thingStores: Record<ActionHashB64, NodeStore> = {};

  private allAgents: AgentPubKey[] = [];

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

    const allAgentsNodeStore = this.nodeStore({
      type: "Anchor",
      id: "SIMPLE_HOLOCHAIN_ALL_AGENTS",
    });
    allAgentsNodeStore.subscribe((val) => {
      if (val.status === "complete" && val.value.content.type === "Anchor") {
        this.allAgents = val.value.linkedNodeIds
          .filter((nodeIdAndTag) => nodeIdAndTag.node_id.type === "Agent")
          .map((nodeIdAndTag) => nodeIdAndTag.node_id.id) as AgentPubKey[];
        console.log(
          "GOT AGENTS: ",
          this.allAgents.map((a) => encodeHashToBase64(a))
        );
      }
    });

    // TODO set up signal listener. Potentially emit signal to conductor
    this.zomeClient.onSignal(async (s) => {
      if (s.type === "Remote") {
        console.log("Got remote signal!");
      }
      let signal = s.content;
      switch (signal.type) {
        case "ThingCreated": {
          // ignore since things are probably mostly discovered through anchors and then the thing will be polled
          const nodeId: NodeId = {
            type: "Thing",
            id: signal.thing.id,
          };
          const nodeStore = this.nodeStore(nodeId);
          nodeStore.nodeStore.update((content) => {
            if (content.status === "complete") {
              content.value.content.content = signal.thing;
              return content;
            }
            return {
              status: "complete",
              value: {
                content: { type: "Thing", content: signal.thing },
                linkedNodeIds: [],
              },
            };
          });
          // Get the records to make sure they are available in the next polling cycle
          setTimeout(() => this.getRecords([signal.thing.id]), 100);
          break;
        }
        case "ThingUpdated": {
          const nodeId: NodeId = {
            type: "Thing",
            id: signal.thing.id,
          };
          const nodeStore = this.nodeStore(nodeId);
          nodeStore.nodeStore.update((content) => {
            if (content.status === "complete") {
              content.value.content.content = signal.thing;
              return content;
            }
            return {
              status: "complete",
              value: {
                content: { type: "Thing", content: signal.thing },
                linkedNodeIds: [],
              },
            };
          });
          setTimeout(
            () =>
              this.getRecords([
                signal.update_action_hash,
                signal.update_link_action_hash,
              ]),
            100
          );
          break;
        }
        case "ThingDeleted": {
          // await this.pollStores(true);
          break;
        }
        case "LinksCreated": {
          console.log("Got LINKS_CREATED SIGNAL!!");

          signal.links.forEach(({ src, dst, tag }) => {
            const nodeStore = this.nodeStore(src);
            nodeStore.nodeStore.update((store) => {
              if (store.status === "complete") {
                const currentLinkedNodeIds = store.value.linkedNodeIds;
                const nodeExists = currentLinkedNodeIds.find((nodeIdAndTag) =>
                  areNodeAndTagEqual({ node_id: dst, tag }, nodeIdAndTag)
                );
                if (nodeExists) return store;
                currentLinkedNodeIds.push({ node_id: dst, tag });
                store.value.linkedNodeIds = currentLinkedNodeIds;
              }
              return store;
            });
          });
          setTimeout(
            () =>
              this.getRecords(
                signal.links.map((link) => link.create_action_hash)
              ),
            100
          );
          break;
        }
        case "LinksDeleted": {
          signal.links.forEach(({ src, dst, tag }) => {
            const nodeStore = this.nodeStore(src);
            nodeStore.nodeStore.update((store) => {
              if (store.status === "complete") {
                const currentLinkedNodeIds = store.value.linkedNodeIds;
                store.value.linkedNodeIds = currentLinkedNodeIds.filter(
                  (nodeIdAndTag) => !areNodeAndTagEqual({ node_id: dst, tag }, nodeIdAndTag)
                );
              }
              return store;
            });
          });
          await this.pollStores(true);
          break;
        }
      }
      // If it's a local signal, forward it to all other agents
      if (s.type === "Local") {
        const input: RemoteSignalInput = {
          signal: {
            type: "Remote",
            content: signal,
          },
          agents: this.allAgents,
        };
        await this.callZome("remote_signal", input);
      }
    });
    window.__SIMPLE_PEER_POLL_INTERVAL__ = window.setInterval(
      () => this.pollStores(),
      DEFAULT_POLLING_PERIOD
    );
    setTimeout(() => this.pollStores());
  }

  /**
   *
   * @param appClient (optional) An AppClient with an already established app websocket connection
   * @param options (optional) If no AppClient is provided, this argument allows to specify
   * the websocket connection options
   * @returns
   */
  static async connect(
    appClient?: AppClient,
    options: AppWebsocketConnectionOptions = {}
  ) {
    // We olny want one global instance of SimpleHolochain to omit accumulating poll intervals
    if (window.__SIMPLE_HOLOCHAIN__) return window.__SIMPLE_HOLOCHAIN__;
    if (!appClient) {
      appClient = await AppWebsocket.connect(options);
    }
    const zomeClient = new ZomeClient<GenericZomeSignal>(
      appClient,
      "generic_dna",
      "generic_zome"
    );
    const simpleHolochain = new SimpleHolochain(appClient, zomeClient);
    // In case another SimpleHolochain got created while we were connecting to the appwebsocket, cancel
    if (window.__SIMPLE_HOLOCHAIN__) return window.__SIMPLE_HOLOCHAIN__;
    window.__SIMPLE_HOLOCHAIN__ = simpleHolochain;
    return simpleHolochain;
  }

  private nodeStore(nodeId: NodeId): NodeStore {
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

  subscribeToNode(
    nodeId: NodeId,
    cb: (value: AsyncStatus<NodeStoreContent>) => any
  ): Unsubscriber {
    const nodeStore = this.nodeStore(nodeId);
    return nodeStore.subscribe(cb);
  }

  /**
   * Updates the contents of the node stores. If allowDelete is false (default)
   * then existing linked node ids will not get deleted. This is to prevent
   * deletion of links that arrived via signals.
   *
   * @param contents
   * @param allowDelete
   */
  nodeContentsToStore(contents: NodeAndLinkedIds[], allowDelete = false): void {
    contents.forEach((nodeAndLinkedIds) => {
      switch (nodeAndLinkedIds.content.type) {
        case "Anchor": {
          const nodeStore = this.anchorStores[nodeAndLinkedIds.content.content];
          if (nodeStore) {
            if (allowDelete) {
              nodeStore.nodeStore.set({
                status: "complete",
                value: {
                  content: {
                    type: "Anchor",
                    content: nodeAndLinkedIds.content.content,
                  },
                  linkedNodeIds: nodeAndLinkedIds.linked_node_ids,
                },
              });
            } else {
              nodeStore.nodeStore.update((store) => {
                let newLinkedNodeIds: NodeIdAndTag[] = [];
                if (store.status === "complete") {
                  newLinkedNodeIds = store.value.linkedNodeIds;
                }
                nodeAndLinkedIds.linked_node_ids.forEach((nodeIdAndTag) => {
                  if (!containsNodeIdAndTag(newLinkedNodeIds, nodeIdAndTag)) {
                    newLinkedNodeIds.push(nodeIdAndTag);
                  }
                });
                return {
                  status: "complete",
                  value: {
                    content: {
                      type: "Anchor",
                      content: nodeAndLinkedIds.content.content as string,
                    },
                    linkedNodeIds: newLinkedNodeIds,
                  },
                };
              });
            }
          }
          break;
        }
        case "Agent": {
          const nodeStore =
            this.anchorStores[
              encodeHashToBase64(nodeAndLinkedIds.content.content)
            ];
          if (nodeStore) {
            if (allowDelete) {
              nodeStore.nodeStore.set({
                status: "complete",
                value: {
                  content: {
                    type: "Agent",
                    content: nodeAndLinkedIds.content.content,
                  },
                  linkedNodeIds: nodeAndLinkedIds.linked_node_ids,
                },
              });
            } else {
              nodeStore.nodeStore.update((store) => {
                let newLinkedNodeIds: NodeIdAndTag[] = [];
                if (store.status === "complete") {
                  newLinkedNodeIds = store.value.linkedNodeIds;
                }
                nodeAndLinkedIds.linked_node_ids.forEach((nodeIdAndTag) => {
                  if (!containsNodeIdAndTag(newLinkedNodeIds, nodeIdAndTag)) {
                    newLinkedNodeIds.push(nodeIdAndTag);
                  }
                });
                return {
                  status: "complete",
                  value: {
                    content: {
                      type: "Agent",
                      content: nodeAndLinkedIds.content.content as AgentPubKey,
                    },
                    linkedNodeIds: newLinkedNodeIds,
                  },
                };
              });
            }
          }
          break;
        }
        case "Thing": {
          const nodeStore =
            this.thingStores[
              encodeHashToBase64(nodeAndLinkedIds.content.content.id)
            ];
          if (nodeStore) {
            if (allowDelete) {
              nodeStore.nodeStore.set({
                status: "complete",
                value: {
                  content: {
                    type: "Thing",
                    content: nodeAndLinkedIds.content.content,
                  },
                  linkedNodeIds: nodeAndLinkedIds.linked_node_ids,
                },
              });
            } else {
              nodeStore.nodeStore.update((store) => {
                let newLinkedNodeIds: NodeIdAndTag[] = [];
                if (store.status === "complete") {
                  newLinkedNodeIds = store.value.linkedNodeIds;
                }
                nodeAndLinkedIds.linked_node_ids.forEach((nodeIdAndTag) => {
                  if (!containsNodeIdAndTag(newLinkedNodeIds, nodeIdAndTag)) {
                    newLinkedNodeIds.push(nodeIdAndTag);
                  }
                });
                return {
                  status: "complete",
                  value: {
                    content: {
                      type: "Thing",
                      content: nodeAndLinkedIds.content.content as Thing,
                    },
                    linkedNodeIds: nodeAndLinkedIds.linked_node_ids,
                  },
                };
              });
            }
          }
        }
      }
    });
  }

  async pollStore(nodeId: NodeId, allowDelete = false): Promise<void> {
    const nodeAndLinkedIds = await this.getNodeAndLinkedNodeIds(nodeId);
    if (nodeAndLinkedIds)
      this.nodeContentsToStore([nodeAndLinkedIds], allowDelete);
  }

  async pollStoresById(nodeIds: NodeId[], allowDelete = false): Promise<void> {
    const nodesAndLinkedIds = await this.batchGetNodeAndLinkedNodeIds(nodeIds);
    this.nodeContentsToStore(nodesAndLinkedIds, allowDelete);
  }

  async pollStores(allowDelete = false): Promise<void> {
    console.log("Polling stores...");
    const anchorStoresToPoll = Object.values(this.anchorStores)
      .filter((nodeStore) => nodeStore.isSubscribed)
      .map((nodeStore) => nodeStore.nodeId);
    const agentStoresToPoll = Object.values(this.agentStores)
      .filter((nodeStore) => nodeStore.isSubscribed)
      .map((nodeStore) => nodeStore.nodeId);
    const thingStoresToPoll = Object.values(this.thingStores)
      .filter((nodeStore) => nodeStore.isSubscribed)
      .map((nodeStore) => nodeStore.nodeId);
    const nodesToPoll = [
      ...anchorStoresToPoll,
      ...agentStoresToPoll,
      ...thingStoresToPoll,
    ];
    console.log("Nodes to poll: ", nodesToPoll);
    const nodesAndLinkedIds = await this.batchGetNodeAndLinkedNodeIds(
      nodesToPoll
    );
    this.nodeContentsToStore(nodesAndLinkedIds, allowDelete);
  }

  async getRecords(
    hashes: AnyDhtHash[]
  ): Promise<(HolochainRecord | undefined)[]> {
    return this.callZome("get_records", hashes);
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
  async getAllLinkedNodeIds(src: NodeId): Promise<NodeIdAndTag[]> {
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
  async getLinkedAgents(
    src: NodeId
  ): Promise<[AgentPubKey, Tag | undefined][]> {
    return this.callZome("get_linked_agents", src);
  }

  /**
   * Get all the anchors that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedAnchors(src: NodeId): Promise<[string, Tag | undefined][]> {
    return this.callZome("get_linked_anchors", src);
  }

  /**
   * Get the latest versions of all Things that are linked from the
   * specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedThings(src: NodeId): Promise<[Thing, Tag | undefined][]> {
    return this.callZome("get_linked_things", src);
  }

  /**
   * Gets the node content and linked node ids for for the given node id
   *
   * @param nodeIds
   * @returns
   */
  async getNodeAndLinkedNodeIds(
    nodeId: NodeId
  ): Promise<NodeAndLinkedIds | undefined> {
    return this.callZome("get_node_and_linked_node_ids", nodeId);
  }

  /**
   * Gets the node content and linked node ids for a list of node ids in a single
   * zome call
   *
   * @param nodeIds
   * @returns
   */
  async batchGetNodeAndLinkedNodeIds(
    nodeIds: NodeId[]
  ): Promise<NodeAndLinkedIds[]> {
    return this.callZome("batch_get_node_and_linked_node_ids", nodeIds);
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

function areNodesEqual(nodeId_a: NodeId, nodeId_b: NodeId): boolean {
  if (nodeId_a.type !== nodeId_b.type) return false;
  if (nodeId_a.type === "Agent" && nodeId_b.type === "Agent")
    return encodeHashToBase64(nodeId_a.id) === encodeHashToBase64(nodeId_b.id);
  if (nodeId_a.type === "Thing" && nodeId_b.type === "Thing")
    return encodeHashToBase64(nodeId_a.id) === encodeHashToBase64(nodeId_b.id);
  if (nodeId_a.type === "Anchor" && nodeId_b.type === "Anchor")
    return nodeId_a.id === nodeId_b.id;
  return false;
}

function areNodeAndTagEqual(
  nodeId_a: NodeIdAndTag,
  nodeId_b: NodeIdAndTag
): boolean {
  if (nodeId_a.node_id.type !== nodeId_b.node_id.type) return false;
  if (nodeId_a.node_id.type === "Agent" && nodeId_b.node_id.type === "Agent")
    return (
      encodeHashToBase64(nodeId_a.node_id.id) ===
        encodeHashToBase64(nodeId_b.node_id.id) && areUint8ArrayEqual(nodeId_a.tag, nodeId_b.tag)
    );
  if (nodeId_a.node_id.type === "Thing" && nodeId_b.node_id.type === "Thing")
    return (
      encodeHashToBase64(nodeId_a.node_id.id) ===
      encodeHashToBase64(nodeId_b.node_id.id) && areUint8ArrayEqual(nodeId_a.tag, nodeId_b.tag)
    );
  if (nodeId_a.node_id.type === "Anchor" && nodeId_b.node_id.type === "Anchor")
    return nodeId_a.node_id.id === nodeId_b.node_id.id && areUint8ArrayEqual(nodeId_a.tag, nodeId_b.tag);
  return false;
}

function containsNodeIdAndTag(
  arr: NodeIdAndTag[],
  nodeIdAndTag: NodeIdAndTag
): boolean {
  for (const id of arr) {
    if (areNodeAndTagEqual(id, nodeIdAndTag)) {
      return true;
    }
  }
  return false;
}

function areUint8ArrayEqual(a, b) {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
  return true;
}
