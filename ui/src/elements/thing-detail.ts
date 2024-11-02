import {
  ActionHash,
  AppClient,
  DnaHash,
  EntryHash,
  HolochainError,
  Record,
} from '@holochain/client';
import { consume } from '@lit/context';
import { Task } from '@lit/task';
import { decode } from '@msgpack/msgpack';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../../elements/edit-thing';

import { simpleHolochainContext } from '../contexts';
import { LinkDirection, SimpleHolochain, Thing } from '@holochain/simple-holochain';

@customElement('thing-detail')
export class ThingDetail extends LitElement {
  @consume({ context: simpleHolochainContext })
  client!: SimpleHolochain;

  @property({
    hasChanged: (newVal: ActionHash, oldVal: ActionHash) =>
      newVal?.toString() !== oldVal?.toString(),
  })
  thingHash!: ActionHash;

  @state()
  _editing = false;

  firstUpdated() {
    if (!this.thingHash) {
      throw new Error(
        `The thingHash property is required for the thing-detail element`
      );
    }
  }

  async deleteThing() {
    try {
      await this.client.deleteThing(this.thingHash, true, true, [
        {
          direction: LinkDirection.From,
          nodeId: {
            type: 'anchor',
            id: 'ALL_POSTS',
          },
        },
      ]);
    } catch (e) {
      alert((e as HolochainError).message);
    }
  }

  renderDetail(record: Record) {
    const thing = decode((record.entry as any).Present.entry) as Thing;

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

  renderThing(record: Record | undefined) {
    if (!record)
      return html`<div class="alert">The requested thing was not found.</div>`;
    if (this._editing) {
      return html`
        <edit-thing
          .originalThingHash=${this.thingHash}
          .currentRecord=${record}
          @thing-updated=${async () => {
            this._editing = false;
            await this._fetchRecord.run();
          }}
          @edit-canceled=${() => {
            this._editing = false;
          }}
        ></edit-thing>
      `;
    }
    return this.renderDetail(record);
  }

  render() {
    return this._fetchRecord.render({
      pending: () => html`<progress></progress>`,
      complete: record => this.renderThing(record),
      error: (e: any) =>
        html`<div class="alert">Error fetching the thing: ${e.message}</div>`,
    });
  }
}
