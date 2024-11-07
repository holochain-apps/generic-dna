import {
  ActionHash,
  AgentPubKey,
  Create,
  CreateLink,
  Delete,
  DeleteLink,
  SignedActionHashed,
  Update,
} from "@holochain/client";

export type GenericZomeSignal =
  | {
      type: "Local";
      content: SignalKind;
    }
  | {
      type: "Remote";
      content: SignalKind;
    };

export type SignalKind =
  | {
      type: "ThingCreated";
      thing: Thing;
    }
  | {
      type: "ThingUpdated";
      thing: Thing;
      update_action_hash: ActionHash;
      update_link_action_hash: ActionHash;
    }
  | {
      type: "ThingDeleted";
      id: ActionHash;
    }
  | {
      type: "LinksCreated";
      links: NodeLink[];
    }
  | {
      type: "LinksDeleted";
      links: NodeLink[];
    }
  | {
      type: "EntryCreated";
      action: SignedActionHashed<Create>;
      app_entry: EntryTypes;
    }
  | {
      type: "EntryUpdated";
      action: SignedActionHashed<Update>;
      app_entry: EntryTypes;
      original_app_entry: EntryTypes;
    }
  | {
      type: "EntryDeleted";
      action: SignedActionHashed<Delete>;
      original_app_entry: EntryTypes;
    }
  | {
      type: "LinkCreated";
      action: SignedActionHashed<CreateLink>;
      link_type: string;
    }
  | {
      type: "LinkDeleted";
      action: SignedActionHashed<DeleteLink>;
      link_type: string;
    };


export type RemoteSignalInput = {
  signal: GenericZomeSignal,
  agents: AgentPubKey[],
}

/* dprint-ignore-start */
export type EntryTypes = { type: "Thing" } & ThingEntry;
/* dprint-ignore-end */

export interface ThingEntry {
  content: string;
}

export type NodeLink = {
  src: NodeId;
  dst: NodeId;
  tag: Uint8Array | undefined;
  create_action_hash: ActionHash;
};

/**
 * A node in the graph can be of three distinct types, identified in different ways
 */
export type NodeId =
  | {
      type: "Anchor";
      id: string;
    }
  | {
      type: "Thing";
      id: ThingId; // "id" --> original action hash
    }
  | {
      type: "Agent";
      id: AgentPubKey;
    };

export type NodeContent =
  | {
      type: "Anchor";
      content: string;
    }
  | {
      type: "Thing";
      content: Thing;
    }
  | {
      type: "Agent";
      content: AgentPubKey;
    };

/**
 * An anchor is a known location identified by a string to
 * or from which things can be linked
 */
export type Anchor = string;

/**
 * A thing is a piece of arbitrary content identified by a
 * ThingHash
 */
export type Thing = {
  id: ThingId;
  content: string;
  creator: AgentPubKey;
  created_at: number;
  updated_at: number;
};

export type ThingId = ActionHash;

export enum LinkDirection {
  From,
  To,
  Bidirectional,
}

export type LinkInput = {
  direction: LinkDirection;
  node_id: NodeId;
  tag?: Uint8Array;
};

export type LinkDirectionRust =
  | {
      type: "From";
    }
  | {
      type: "To";
    }
  | {
      type: "Bidirectional";
    };

export type LinkInputRust = {
  direction: LinkDirectionRust;
  node_id: NodeId;
  tag?: Uint8Array;
};

export type CreateThingInput = {
  content: string;
  links?: LinkInputRust[];
};

export type UpdateThingInput = {
  thing_id: ActionHash;
  updated_content: string;
};

export type DeleteThingInput = {
  thing_id: ActionHash;
  delete_backlinks: boolean;
  delete_links_from_creator: boolean;
  delete_links?: LinkInputRust[];
};

export type CreateOrDeleteLinksInput = {
  src: NodeId;
  links: LinkInputRust[];
};

export type NodeAndLinkedIds = {
  content: NodeContent,
  linked_node_ids: NodeId[],
}