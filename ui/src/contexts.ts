import { createContext } from "@lit/context";
import { SimpleHolochain } from "@holochain/simple-holochain";

export const simpleHolochainContext = createContext<SimpleHolochain>("SimpleHolochain");
