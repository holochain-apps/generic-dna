import { ActionHash, HolochainError, Record } from "@holochain/client";
import { consume } from "@lit/context";
import { decode } from "@msgpack/msgpack";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { simpleHolochainContext } from "../contexts";
import { Thing } from "@holochain/simple-holochain";
import { SimpleHolochain } from "@holochain/simple-holochain";

@customElement("edit-post")
export class EditPost extends LitElement {
  @consume({ context: simpleHolochainContext })
  client!: SimpleHolochain;

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

  async updatePost() {
    try {
      await this.client.updateThing(this.originalThingHash, this._content);
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
          <button .disabled=${!this.isThingValid()} @click=${() => this.updatePost()}>
            Save
          </button>
        </div>
      </section>
    `;
  }
}
