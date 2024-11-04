import { AgentPubKey, AppWebsocketConnectionOptions } from '@holochain/client';
import { LinkInput, NodeContent, NodeId, Thing, ThingId } from './types';
export * from './types';
export declare class SimpleHolochain {
    private client;
    private zomeClient;
    private roleName;
    private zomeName;
    private constructor();
    static connect(options?: AppWebsocketConnectionOptions): Promise<SimpleHolochain>;
    /**
     * Creates a "Thing", i.e. an arbitrary piece of content in the DHT. You are responsible
     * yourself for making sure that the content adheres to the format you want
     * it to adhere.
     *
     * @param content
     * @param links
     * @returns
     */
    createThing(content: string, links?: LinkInput[]): Promise<Thing>;
    /**
     * Update the content of a thing without changing any of
     * the links that point to or from it.
     *
     * @param thingId
     * @param updatedContent
     * @returns
     */
    updateThing(thingId: ThingId, updatedContent: string): Promise<Thing>;
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
    deleteThing(thingId: ThingId, deleteBacklinks: boolean, deleteLinksFromCreator: boolean, deleteLinks?: LinkInput[]): Promise<void>;
    /**
     * Gets the latest known version of a thing (it's possible that other peers
     * have updated it but they are now offline and we don't know about it)
     *
     * @param thingId
     * @returns
     */
    getThing(thingId: ThingId): Promise<Thing>;
    /**
     * Get all the nodes that are linked from the specified source node
     *
     * @param src
     * @returns
     */
    getAllLinkedNodes(src: NodeId): Promise<NodeContent>;
    /**
     * Get all the agents that are linked from the specified source node
     *
     * @param src
     * @returns
     */
    getLinkedAgents(src: NodeId): Promise<AgentPubKey[]>;
    /**
     * Get all the anchors that are linked from the specified source node
     *
     * @param src
     * @returns
     */
    getLinkedAnchors(src: NodeId): Promise<string[]>;
    /**
     * Get the latest versions of all Things that are linked from the
     * specified source node
     *
     * @param src
     * @returns
     */
    getLinkedThings(src: NodeId): Promise<Thing[]>;
    /**
     * Creates links from a specified source node
     *
     * @param src
     * @param links
     * @returns
     */
    createLinks(src: NodeId, links: LinkInput[]): Promise<void>;
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
    deleteLinks(src: NodeId, links: LinkInput[]): Promise<void>;
    private callZome;
}
