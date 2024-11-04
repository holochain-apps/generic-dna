import { ActionHash, AppClient, AppWebsocket, HolochainError } from "@holochain/client";
import { provide } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import HolochainLogo from "./assets/holochainLogo.svg";
import { simpleHolochainContext } from "./contexts";
import { sharedStyles } from "./shared-styles";
import { SimpleHolochain } from "@holochain/simple-holochain";

import './elements/all-posts';
import './elements/create-post';
import './elements/post-detail';

@customElement("holochain-app")
export class HolochainApp extends LitElement {
  @state()
  loading = false;

  @state()
  error: HolochainError | undefined;

  @provide({ context: simpleHolochainContext })
  @property({ type: Object })
  client!: SimpleHolochain;

  async firstUpdated() {
    this.loading = true;
    try {
      this.client = await SimpleHolochain.connect();
    } catch (e) {
      this.error = e as HolochainError;
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (this.loading || !this.client) return html`<progress></progress>`;
    return html`
      <div>
        <div>
          <create-post></create-post>
          <all-posts></all-posts>
        </div>
      </div>
    `;
  }

  static styles = css`
    ${sharedStyles}

    .logo {
      height: 15em;
      padding: 1.5em;
      will-change: filter;
      transition: filter 300ms;
      width: auto;
    }

    .logo:hover {
      filter: drop-shadow(0 0 2em #646cffaa);
    }

    .logo.holochain:hover {
      filter: drop-shadow(0 0 2em #61dafbaa);
    }

    .card {
      padding: 2em;
    }

    .read-the-docs {
      color: #888;
    }
  `;
}
