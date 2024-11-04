import {
  AppClient,
  HolochainError,
  Record,
} from "@holochain/client";
import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { simpleHolochainContext } from "../contexts";
import { sharedStyles } from "../shared-styles";
import { LinkDirection, Thing } from "@holochain/simple-holochain";
import { SimpleHolochain } from "@holochain/simple-holochain";

@customElement("create-post")
export class CreatePost extends LitElement {
  @consume({ context: simpleHolochainContext })
  client!: SimpleHolochain;

  @state()
  _content: string = "";

  firstUpdated() {
  }

  isThingValid() {
    return true && this._content !== "";
  }

  async createPost() {
    try {
      await this.client.createThing(this._content, [
        {
          direction: LinkDirection.From,
          nodeId: {
            type: "anchor",
            id: "ALL_POSTS"
          }
        }
      ]);
    } catch (e) {
      alert((e as HolochainError).message);
    }
  }

  render() {
    return html`
      <div>
        <h3>Create Post</h3>
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
          @click=${() => this.createPost()}
        >
          Create Post
        </button>
      </div>
    `;
  }

  static styles = sharedStyles;
}
