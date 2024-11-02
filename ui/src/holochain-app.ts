import { ActionHash, AppClient, AppWebsocket, HolochainError } from "@holochain/client";
import { provide } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import HolochainLogo from "./assets/holochainLogo.svg";
import { clientContext } from "./contexts";
import { sharedStyles } from "./shared-styles";

@customElement("holochain-app")
export class HolochainApp extends LitElement {
  @state()
  loading = false;

  @state()
  error: HolochainError | undefined;

  @provide({ context: clientContext })
  @property({ type: Object })
  client!: AppClient;

  async firstUpdated() {
    this.loading = true;
    try {
      this.client = await AppWebsocket.connect();
    } catch (e) {
      this.error = e as HolochainError;
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (this.loading) return html`<progress></progress>`;
    return html`
      <div>
        <div>
          <a href="https://developer.holochain.org/get-started/" target="_blank">
            <img .src=${HolochainLogo} class="logo holochain" alt="holochain logo" />
          </a>
        </div>
        <h1>Holochain Lit hApp</h1>
        <div>
          <div class="card">
            ${this.loading ? html`<p>connecting...</p>` : ""}
            ${this.error ? html`<p>${this.error.message}</p>` : html`<p>Client is connected.</p>`}
          </div>
          <p>Import scaffolded components into <code>src/holochain-app.ts</code> to use your hApp</p>
          <p class="read-the-docs">Click on the Holochain logo to learn more</p>
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
