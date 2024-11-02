import { AppClient } from "@holochain/client";
import { createContext } from "@lit/context";

export const clientContext = createContext<AppClient>("AppClient");
