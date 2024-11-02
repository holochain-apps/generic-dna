import { ZomeClient } from '@holochain-open-dev/utils';
import {
  AgentPubKey,
  AppCallZomeRequest,
  AppClient,
  AppWebsocket,
  AppWebsocketConnectionOptions,
} from '@holochain/client';
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
} from './types';

export * from './types';

export class SimpleHolochain {
  private client: AppClient;
  private zomeClient: ZomeClient<GenericZomeSignal>;
  private roleName: string;
  private zomeName: string;

  private constructor(
    client: AppClient,
    zomeClient: ZomeClient<GenericZomeSignal>,
    roleName: string = 'generic_dna',
    zomeName: string = 'generic_zome'
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
      'generic_dna',
      'generic_zome'
    );
    return new SimpleHolochain(client, zomeClient);
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
      links: links ? links.map(link => linkInputToRustFormat(link)) : undefined,
    };
    return this.callZome('create_thing', input);
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
    return this.callZome('udpate_thing', input);
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
        ? deleteLinks.map(link => linkInputToRustFormat(link))
        : undefined,
    };
    return this.callZome('delete_thing', input);
  }

  /**
   * Gets the latest known version of a thing (it's possible that other peers
   * have updated it but they are now offline and we don't know about it)
   *
   * @param thingId
   * @returns
   */
  async getThing(thingId: ThingId): Promise<Thing> {
    return this.callZome('get_thing', thingId);
  }

  /**
   * Get all the nodes that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getAllLinkedNodes(src: NodeId): Promise<NodeContent> {
    return this.callZome('get_all_linked_nodes', src);
  }

  /**
   * Get all the agents that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedAgents(src: NodeId): Promise<AgentPubKey[]> {
    return this.callZome('get_linked_agents', src);
  }

  /**
   * Get all the anchors that are linked from the specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedAnchors(src: NodeId): Promise<string[]> {
    return this.callZome('get_linked_anchors', src);
  }

  /**
   * Get the latest versions of all Things that are linked from the
   * specified source node
   *
   * @param src
   * @returns
   */
  async getLinkedThings(src: NodeId): Promise<Thing[]> {
    return this.callZome('get_linked_things', src);
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
      links: links.map(link => linkInputToRustFormat(link)),
    };
    return this.callZome('create_links_from_node', input);
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
      links: links.map(link => linkInputToRustFormat(link)),
    };
    return this.callZome('delete_links_from_node', input);
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
        type: 'From',
      };
    case LinkDirection.To:
      linkDirection = { type: 'To' };
    case LinkDirection.Bidirectional:
      linkDirection = { type: 'Bidirectional' };
  }
  return {
    direction: linkDirection,
    nodeId: linkInput.nodeId,
    tag: linkInput.tag,
  };
}
