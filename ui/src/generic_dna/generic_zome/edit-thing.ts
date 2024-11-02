import { ActionHash, AgentPubKey, AppClient, DnaHash, EntryHash, HolochainError, Record } from "@holochain/client";
import { consume } from "@lit/context";
import { decode } from "@msgpack/msgpack";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { clientContext } from "../../contexts";
import { Thing } from "./types";

@customElement("edit-thing")
export class EditThing extends LitElement {
  @consume({ context: clientContext })
  client!: AppClient;

  @property({
    hasChanged: (newVal: ActionHash, oldVal: ActionHash) => newVal?.toString() !== oldVal?.toString(),
  })
  originalThingHash!: ActionHash;

  @property()
  currentRecord!: Record;

  get currentThing() {
    return decode((this.currentRecord.entry as any).Present.entry) as Thing;
  }

  @state()
  _content!: string;

  isThingValid() {
    return true && this._content !== "";
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.currentRecord) {
      throw new Error(`The currentRecord property is required for the edit-thing element`);
    }

    if (!this.originalThingHash) {
      throw new Error(`The originalThingHash property is required for the edit-thing element`);
    }

    this._content = this.currentThing.content;
  }

  async updateThing() {
    const thing: Thing = {
      content: this._content!,
    };

    try {
      const updateRecord: Record = await this.client.callZome({
        cap_secret: null,
        role_name: "generic_dna",
        zome_name: "generic_zome",
        fn_name: "update_thing",
        payload: {
          original_thing_hash: this.originalThingHash,
          previous_thing_hash: this.currentRecord.signed_action.hashed.hash,
          updated_thing: thing,
        },
      });

      this.dispatchEvent(
        new CustomEvent("thing-updated", {
          composed: true,
          bubbles: true,
          detail: {
            originalThingHash: this.originalThingHash,
            previousThingHash: this.currentRecord.signed_action.hashed.hash,
            updatedThingHash: updateRecord.signed_action.hashed.hash,
          },
        }),
      );
    } catch (e) {
      alert((e as HolochainError).message);
    }
  }

  render() {
    return html`
      <section>
        <div>
          <label for="Content">Content</label>
          <input
            name="Content"
  .value=${this._content}
  @input=${(e: CustomEvent) => {
      this._content = (e.target as any).value;
    }}
  required
>
        </div>


        <div>
          <button @click=${() =>
      this.dispatchEvent(
        new CustomEvent("edit-canceled", {
          bubbles: true,
          composed: true,
        }),
      )}
          >
            Cancel
          </button>
          <button .disabled=${!this.isThingValid()} @click=${() => this.updateThing()}>
            Save
          </button>
        </div>
      </section>
    `;
  }
}
