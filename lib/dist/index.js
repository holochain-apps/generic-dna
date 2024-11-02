import { ZomeClient } from '@holochain-open-dev/utils';
import { AppWebsocket, } from '@holochain/client';
import { LinkDirection, } from './types';
export * from './types';
export class SimpleHolochain {
    constructor(client, zomeClient, roleName = 'generic_dna', zomeName = 'generic_zome') {
        this.client = client;
        this.zomeClient = zomeClient;
        this.roleName = roleName;
        this.zomeName = zomeName;
        // TODO set up signal listener. Potentially emit signal to conductor
    }
    static async connect(options = {}) {
        const client = await AppWebsocket.connect(options);
        const zomeClient = new ZomeClient(client, 'generic_dna', 'generic_zome');
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
    async createThing(content, links) {
        let input = {
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
    async updateThing(thingId, updatedContent) {
        let input = {
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
    async deleteThing(thingId, deleteBacklinks, deleteLinksFromCreator, deleteLinks) {
        let input = {
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
    async getThing(thingId) {
        return this.callZome('get_thing', thingId);
    }
    /**
     * Get all the nodes that are linked from the specified source node
     *
     * @param src
     * @returns
     */
    async getAllLinkedNodes(src) {
        return this.callZome('get_all_linked_nodes', src);
    }
    /**
     * Get all the agents that are linked from the specified source node
     *
     * @param src
     * @returns
     */
    async getLinkedAgents(src) {
        return this.callZome('get_linked_agents', src);
    }
    /**
     * Get all the anchors that are linked from the specified source node
     *
     * @param src
     * @returns
     */
    async getLinkedAnchors(src) {
        return this.callZome('get_linked_anchors', src);
    }
    /**
     * Get the latest versions of all Things that are linked from the
     * specified source node
     *
     * @param src
     * @returns
     */
    async getLinkedThings(src) {
        return this.callZome('get_linked_things', src);
    }
    /**
     * Creates links from a specified source node
     *
     * @param src
     * @param links
     * @returns
     */
    async createLinks(src, links) {
        const input = {
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
    async deleteLinks(src, links) {
        const input = {
            src,
            links: links.map(link => linkInputToRustFormat(link)),
        };
        return this.callZome('delete_links_from_node', input);
    }
    callZome(fn_name, payload) {
        const req = {
            role_name: this.roleName,
            zome_name: this.zomeName,
            fn_name,
            payload,
        };
        return this.client.callZome(req);
    }
}
function linkInputToRustFormat(linkInput) {
    let linkDirection;
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
//# sourceMappingURL=index.js.map