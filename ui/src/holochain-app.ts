import { HolochainError } from "@holochain/client";
import { createContext, provide } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { simpleHolochainContext } from "./contexts";
import { sharedStyles } from "./shared-styles";
import { SimpleHolochain } from "@holochain/simple-holochain";

import './elements/all-posts';
import './elements/create-post';
import './elements/post-detail';
import { initializeHotReload, isWeaveContext, WeaveClient } from "@theweave/api";

export const weaveClientContext = createContext<WeaveClient | undefined>('weave_client');


@customElement("holochain-app")
export class HolochainApp extends LitElement {
  @state()
  loading = false;

  @state()
  error: HolochainError | undefined;

  @provide({ context: simpleHolochainContext })
  @property({ type: Object })
  simpleHolochain!: SimpleHolochain;

  @provide({ context: weaveClientContext })
  @property({ type: Object })
  weaveClient!: WeaveClient | undefined;

  async firstUpdated() {
    this.loading = true;
    if ((import.meta as any).env.DEV) {
      try {
        await initializeHotReload();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          'Could not initialize applet hot-reloading. This is only expected to work in a We context in dev mode.'
        );
      }
    }
    try {
      if (isWeaveContext()) {
        const weaveClient = await WeaveClient.connect();
        if (
          weaveClient.renderInfo.type !== 'applet-view' ||
          !['main'].includes(weaveClient.renderInfo.view.type)
        )
          throw new Error(
            'This Tool only implements the applet main view.'
          );
        this.simpleHolochain = await SimpleHolochain.connect(weaveClient.renderInfo.appletClient);
      } else {
        this.simpleHolochain = await SimpleHolochain.connect();
      }
    } catch (e) {
      this.error = e as HolochainError;
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (this.loading || !this.simpleHolochain) return html`<progress></progress>`;
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
