import { ActionHash, AppClient, DnaHash, EntryHash, HolochainError, Record } from "@holochain/client";
import { consume } from "@lit/context";
import { Task } from "@lit/task";
import { decode } from "@msgpack/msgpack";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import "./edit-thing";

import { clientContext } from "../../contexts";
import { Thing } from "./types";

@customElement("thing-detail")
export class ThingDetail extends LitElement {
  @consume({ context: clientContext })
  client!: AppClient;

  @property({
    hasChanged: (newVal: ActionHash, oldVal: ActionHash) => newVal?.toString() !== oldVal?.toString(),
  })
  thingHash!: ActionHash;

  _fetchRecord = new Task(this, ([thingHash]: Array<ActionHash>) =>
    this.client.callZome({
      cap_secret: null,
      role_name: "generic_dna",
      zome_name: "generic_zome",
      fn_name: "get_latest_thing",
      payload: thingHash,
    }) as Promise<Record | undefined>, () => [this.thingHash]);

  @state()
  _editing = false;

  firstUpdated() {
    if (!this.thingHash) {
      throw new Error(`The thingHash property is required for the thing-detail element`);
    }
  }

  async deleteThing() {
    try {
      await this.client.callZome({
        cap_secret: null,
        role_name: "generic_dna",
        zome_name: "generic_zome",
        fn_name: "delete_thing",
        payload: this.thingHash,
      });
      this.dispatchEvent(
        new CustomEvent("thing-deleted", {
          bubbles: true,
          composed: true,
          detail: {
            thingHash: this.thingHash,
          },
        }),
      );
      this._fetchRecord.run();
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
          <button @click=${() => {
      this._editing = true;
    }}>edit</button>
          <button @click=${() => this.deleteThing()}>delete</button>
        </div>
      </section>
    `;
  }

  renderThing(record: Record | undefined) {
    if (!record) return html`<div class="alert">The requested thing was not found.</div>`;
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
      complete: (record) => this.renderThing(record),
      error: (e: any) => html`<div class="alert">Error fetching the thing: ${e.message}</div>`,
    });
  }
}
