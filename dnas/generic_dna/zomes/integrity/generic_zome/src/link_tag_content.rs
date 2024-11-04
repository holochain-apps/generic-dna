use hdi::prelude::*;

use crate::NodeId;

#[derive(Serialize, Deserialize, SerializedBytes, Debug)]
pub struct LinkTagContent {
    pub tag: Option<Vec<u8>>,
    // action hash of the backlink. Used to efficiently delete the backlink
    // without having to do a get_links and filter by link targets.
    // This seems worth it since relationship tags may potentially be
    // used by many many different AssetRelation entries.
    pub backlink_action_hash: Option<ActionHash>,
    // For links to anchors we store the anchor string as well to be able
    // to retrieve the anchor string that they're pointing to directly
    // from the link
    pub target_node_id: NodeId,
}

pub fn serialize_link_tag(link_tag_content: LinkTagContent) -> ExternResult<Vec<u8>> {
    Ok(ExternIO::encode(link_tag_content)
        .map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to encode link tag content: {e}"
            )))
        })?
        .into_vec())
}

pub fn deserialize_link_tag(tag: Vec<u8>) -> ExternResult<LinkTagContent> {
    ExternIO::from(tag).decode::<LinkTagContent>().map_err(|e| {
        wasm_error!(WasmErrorInner::Guest(format!(
            "Failed to decode link tag content: {e}"
        )))
    })
}
