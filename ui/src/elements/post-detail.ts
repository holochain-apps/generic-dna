import { ActionHash, HolochainError } from '@holochain/client';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './edit-post';

import { simpleHolochainContext } from '../contexts';
import {
  AsyncStatus,
  LinkDirection,
  NodeStoreContent,
  SimpleHolochain,
  Thing,
} from '@holochain/simple-holochain';

@customElement('post-detail')
export class PostDetail extends LitElement {
  @consume({ context: simpleHolochainContext })
  simpleHolochain!: SimpleHolochain;

  @property({
    hasChanged: (newVal: ActionHash, oldVal: ActionHash) =>
      newVal?.toString() !== oldVal?.toString(),
  })
  thingHash!: ActionHash;

  @state()
  _editing = false;

  @state()
  nodeContent: AsyncStatus<NodeStoreContent> = { status: 'pending' };

  @state()
  nodeStoreUnsubscriber: (() => void) | undefined;

  firstUpdated() {
    if (!this.thingHash) {
      throw new Error(
        `The thingHash property is required for the thing-detail element`
      );
    }
    this.nodeStoreUnsubscriber = this.simpleHolochain.subscribeToNode(
      {
        type: 'Thing',
        id: this.thingHash,
      },
      val => {
        this.nodeContent = val;
      }
    );
  }

  disconnectedCallback(): void {
    if (this.nodeStoreUnsubscriber) this.nodeStoreUnsubscriber();
  }

  async deleteThing() {
    try {
      await this.simpleHolochain.deleteThing(this.thingHash, true, true, [
        {
          direction: LinkDirection.From,
          node_id: {
            type: 'Anchor',
            id: 'ALL_POSTS',
          },
        },
      ]);
    } catch (e) {
      console.error((e as HolochainError).message);
      alert((e as HolochainError).message);
    }
  }

  renderDetail(nodeContent: NodeStoreContent) {
    const thing = nodeContent.content.content as Thing;

    return html`
      <section>
        <div>
          <span><strong>Content: </strong></span>
          <span>${thing.content}</span>
        </div>

        <div>
          <button
            @click=${() => {
              this._editing = true;
            }}
          >
            edit
          </button>
          <button @click=${() => this.deleteThing()}>delete</button>
        </div>
      </section>
    `;
  }

  render() {
    if (this.nodeContent.status === 'error')
      return html`<div class="alert">
        Error fetching the Thing: ${this.nodeContent.error}
      </div>`;
    if (this.nodeContent.status === 'pending')
      return html`<progress></progress>`;
    // if (this._editing) {
    //   return html`
    //     <edit-post
    //       .originalThingHash=${this.thingHash}
    //       .currentRecord=${record}
    //       @thing-updated=${async () => {
    //         this._editing = false;
    //         await this._fetchRecord.run();
    //       }}
    //       @edit-canceled=${() => {
    //         this._editing = false;
    //       }}
    //     ></edit-post>
    //   `;
    // }
    return this.renderDetail(this.nodeContent.value);
  }
}
