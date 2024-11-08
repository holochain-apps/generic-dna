import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import './post-detail';
import './edit-post';

import { simpleHolochainContext } from '../contexts';
import {
  AsyncStatus,
  NodeId,
  NodeStoreContent,
  SimpleHolochain,
} from '@holochain/simple-holochain';

@customElement('all-posts')
export class AllPosts extends LitElement {
  @consume({ context: simpleHolochainContext })
  simpleHolochain!: SimpleHolochain;

  @state()
  nodeContent: AsyncStatus<NodeStoreContent> = { status: 'pending' };

  @state()
  nodeStoreUnsubscriber: (() => void) | undefined;

  firstUpdated() {
    this.nodeStoreUnsubscriber = this.simpleHolochain.subscribeToNode(
      {
        type: 'Anchor',
        id: 'ALL_POSTS',
      },
      status => {
        this.nodeContent = status;
        this.requestUpdate();
      }
    );
  }

  disconnectedCallback(): void {
    if (this.nodeStoreUnsubscriber) this.nodeStoreUnsubscriber();
  }

  renderNodes(nodeIds: NodeId[]) {
    const thingNodes = nodeIds.filter(nodeId => nodeId.type === 'Thing');
    console.log('Rendering thingNodes: ', thingNodes);
    return thingNodes.map(
      node => html` <post-detail .thingHash=${node.id}></post-detail> `
    );
  }

  render() {
    if (this.nodeContent.status === 'error')
      return html`<div class="alert">
        Error fetching the thing: ${this.nodeContent.error}
      </div>`;
    if (this.nodeContent.status === 'pending')
      return html`<progress></progress>`;
    return this.renderNodes(this.nodeContent.value.linkedNodeIds);
  }
}
