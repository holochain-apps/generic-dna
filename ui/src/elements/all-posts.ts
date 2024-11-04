import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import './post-detail';
import './edit-post';

import { simpleHolochainContext } from '../contexts';
import { AsyncStatus, NodeId, NodeStoreContent, SimpleHolochain } from '@holochain/simple-holochain';

@customElement('all-posts')
export class AllPosts extends LitElement {
  @consume({ context: simpleHolochainContext })
  client!: SimpleHolochain;

  @state()
  nodeContent: AsyncStatus<NodeStoreContent> = { status: "pending" };

  @state()
  nodeStoreUnsubscriber: (() => void) | undefined;

  firstUpdated() {
    const nodeStore = this.client.nodeStore({
      type: "Anchor",
      id: "ALL_POSTS",
    })
    this.nodeStoreUnsubscriber = nodeStore.subscribe((val) => {
      console.log("Got new wal: ", val);
      this.nodeContent = val;
    })
  }

  disconnectedCallback(): void {
    if (this.nodeStoreUnsubscriber) this.nodeStoreUnsubscriber();
  }

  renderNodes(nodeIds: NodeId[]) {
    const thingNodes = nodeIds.filter((nodeId) => nodeId.type === "Thing");
    console.log("Rendering thingNodes: ", thingNodes);
    return thingNodes.map((node) => html`
    <post-detail .thingHash=${node.id}></post-detail>
    `)
  }

  render() {
    if (this.nodeContent.status === "error") return html`<div class="alert">Error fetching the thing: ${this.nodeContent.error}</div>`;
    if (this.nodeContent.status === "pending") return html`<progress></progress>`;
    return this.renderNodes(this.nodeContent.value.linkedNodeIds);
  }
}
