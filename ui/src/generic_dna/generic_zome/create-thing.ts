import {
  ActionHash,
  AgentPubKey,
  AppClient,
  DnaHash,
  EntryHash,
  HolochainError,
  InstalledCell,
  Record,
} from "@holochain/client";
import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { clientContext } from "../../contexts";
import { sharedStyles } from "../../shared-styles";
import { Thing } from "./types";

@customElement("create-thing")
export class CreateThing extends LitElement {
  @consume({ context: clientContext })
  client!: AppClient;

  @state()
  _content: string = "";

  firstUpdated() {
  }

  isThingValid() {
    return true && this._content !== "";
  }

  async createThing() {
    const thing: Thing = {
      content: this._content,
    };

    try {
      const record: Record = await this.client.callZome({
        cap_secret: null,
        role_name: "generic_dna",
        zome_name: "generic_zome",
        fn_name: "create_thing",
        payload: thing,
      });

      this.dispatchEvent(
        new CustomEvent("thing-created", {
          composed: true,
          bubbles: true,
          detail: {
            thingHash: record.signed_action.hashed.hash,
          },
        }),
      );
    } catch (e) {
      alert((e as HolochainError).message);
    }
  }

  render() {
    return html`
      <div>
        <h3>Create Thing</h3>
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

        <button
          .disabled=${!this.isThingValid()}
          @click=${() => this.createThing()}
        >
          Create Thing
        </button>
      </div>
    `;
  }

  static styles = sharedStyles;
}
