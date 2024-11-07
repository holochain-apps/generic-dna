use crate::{NodeLink, Signal, SignalKind, Thing};
use generic_zome_integrity::*;
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum LinkDirection {
    From,
    To,
    Bidirectional,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", content = "content")]
pub enum NodeContent {
    Agent(AgentPubKey),
    Anchor(String),
    Thing(Thing),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NodeIdAndTag {
    node_id: NodeId,
    tag: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinkInput {
    pub direction: LinkDirection,
    pub node_id: NodeId,
    pub tag: Option<Vec<u8>>,
}

// This just forwards the hdk get that can be called to make sure a certain
// hash that is konwn about via remote signal gets fetched and will therefore be
// returned with the next polling cycle
#[hdk_extern]
pub fn get_records(hashes: Vec<AnyDhtHash>) -> ExternResult<Vec<Option<Record>>> {
    let get_input: Vec<GetInput> = hashes
        .into_iter()
        .map(|hash| Ok(GetInput::new(hash, GetOptions::default())))
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    Ok(records)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateThingInput {
    pub content: String,
    pub links: Option<Vec<LinkInput>>,
}

#[hdk_extern]
pub fn create_thing(input: CreateThingInput) -> ExternResult<Thing> {
    // 1. Create the Thing entry
    let thing_id = create_entry(&EntryTypes::Thing(ThingEntry {
        content: input.content.clone(),
    }))?;

    let thing_record = get(thing_id.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest("Failed to get record that was just created.".into())
    ))?;

    let mut links_created: Vec<NodeLink> = Vec::new();

    // 2. Create all links as necessary
    match input.links.clone() {
        Some(links) => {
            for link in links {
                let (node_link, maybe_backlink) =
                    create_link_from_node_by_id(NodeId::Thing(thing_id.clone()), link.clone())?;
                links_created.push(node_link);
                if let Some(backlink) = maybe_backlink {
                    links_created.push(backlink);
                }
            }
        }
        None => (),
    }

    let thing = Thing {
        id: thing_id,
        content: input.content,
        creator: thing_record.action().author().clone(),
        created_at: thing_record.action().timestamp(),
        updated_at: None,
    };

    // 3. Emit signals to the frontend
    emit_signal(Signal::Local(SignalKind::ThingCreated {
        thing: thing.clone(),
    }))?;
    if let Some(_) = input.links.clone() {
        emit_signal(Signal::Local(SignalKind::LinksCreated {
            links: links_created,
        }))?;
    }

    Ok(thing)
}

/// Gets the latest known version of a Thing
#[hdk_extern]
pub fn get_latest_thing(thing_id: ActionHash) -> ExternResult<Option<Thing>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(thing_id.clone(), LinkTypes::ThingUpdates)?.build(),
    )?;
    let thing_record = get_latest_thing_from_links(links)?;
    match thing_record {
        Some(r) => Ok(Some(thing_record_to_thing(r)?)),
        None => {
            let maybe_original_record = get(thing_id, GetOptions::default())?;
            match maybe_original_record {
                Some(r) => Ok(Some(thing_record_to_thing(r)?)),
                None => Ok(None),
            }
        }
    }
}

fn get_latest_thing_from_links(mut links: Vec<Link>) -> ExternResult<Option<Record>> {
    links.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    for link in links {
        if let Some(thing_id) = link.target.into_action_hash() {
            let maybe_record = get(thing_id, GetOptions::default())?;
            if let Some(record) = maybe_record {
                return Ok(Some(record));
            }
        }
    }
    Ok(None)
}

/// For a vector of provided thing ids, get all the respective latest known Thing
#[hdk_extern]
pub fn get_latest_things(thing_ids: Vec<ActionHash>) -> ExternResult<Vec<Option<Thing>>> {
    let mut latest_things: Vec<Option<Thing>> = Vec::new();
    for thing_id in thing_ids {
        let maybe_thing = get_latest_thing(thing_id)?;
        latest_things.push(maybe_thing);
    }
    Ok(latest_things)
}

#[hdk_extern]
pub fn get_original_thing(original_thing_id: ActionHash) -> ExternResult<Option<Thing>> {
    let maybe_thing_record = get(original_thing_id.clone(), GetOptions::default())?;
    match maybe_thing_record {
        Some(record) => {
            let thing = thing_record_to_thing(record)?;
            Ok(Some(thing))
        }
        None => Ok(None),
    }
}

#[hdk_extern]
pub fn get_all_revisions_for_thing(thing_id: ActionHash) -> ExternResult<Vec<Thing>> {
    let Some(original_record) = get(thing_id.clone(), GetOptions::default())? else {
        return Err(wasm_error!(WasmErrorInner::Guest(
            "No original record found for this thing_id (action hash).".into()
        )));
    };
    let links = get_links(
        GetLinksInputBuilder::try_new(thing_id.clone(), LinkTypes::ThingUpdates)?.build(),
    )?;
    let get_input: Vec<GetInput> = links
        .into_iter()
        .map(|link| {
            Ok(GetInput::new(
                link.target
                    .into_action_hash()
                    .ok_or(wasm_error!(WasmErrorInner::Guest(
                        "No action hash associated with link".to_string()
                    )))?
                    .into(),
                GetOptions::default(),
            ))
        })
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    let mut records: Vec<Record> = records.into_iter().flatten().collect();
    records.insert(0, original_record);
    Ok(records
        .into_iter()
        .map(|r| thing_record_to_thing(r).ok())
        .filter_map(|t| t)
        .collect())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateThingInput {
    pub thing_id: ActionHash,
    pub updated_content: String,
}

#[hdk_extern]
pub fn update_thing(input: UpdateThingInput) -> ExternResult<Thing> {
    let updated_thing_hash = create_entry(&EntryTypes::Thing(ThingEntry {
        content: input.updated_content.clone(),
    }))?;

    let thing_record = get(input.thing_id.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest("Failed to get record of original Thing.".into())
    ))?;

    let updated_thing_record = get(updated_thing_hash.clone(), GetOptions::default())?.ok_or(
        wasm_error!(WasmErrorInner::Guest(
            "Failed to get record of Thing update that was just created.".into()
        )),
    )?;

    let update_link_action_hash = create_link(
        input.thing_id.clone(),
        updated_thing_hash.clone(),
        LinkTypes::ThingUpdates,
        (),
    )?;

    let thing = Thing {
        id: input.thing_id,
        content: input.updated_content,
        creator: thing_record.action().author().clone(),
        created_at: thing_record.action().timestamp(),
        updated_at: Some(updated_thing_record.action().timestamp()),
    };

    // 3. Emit signals to the frontend
    emit_signal(Signal::Local(SignalKind::ThingUpdated {
        thing: thing.clone(),
        update_action_hash: updated_thing_hash,
        update_link_action_hash,
    }))?;

    Ok(thing)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DeleteThingInput {
    pub thing_id: ActionHash,
    pub delete_backlinks: bool,
    pub delete_links_from_creator: bool,
    pub delete_links: Option<Vec<LinkInput>>,
}

/// Deletes a thing and all associated links and backlinks
#[hdk_extern]
pub fn delete_thing(input: DeleteThingInput) -> ExternResult<()> {
    let thing_record = match get(input.thing_id.clone(), GetOptions::default())? {
        Some(r) => r,
        None => {
            return Err(wasm_error!(WasmErrorInner::Guest(
                "Did not find Thing to delete.".into()
            )))
        }
    };

    let mut links_deleted: Vec<NodeLink> = Vec::new();

    // 1. Delete the original Thing entry (don't care about updates as they are anyway
    // not retreivable without the original Thing entry)
    delete_entry(input.thing_id.clone())?;

    // 2. Delete all backlinks from bidirectional links
    if input.delete_backlinks {
        let links_to_agents = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_agents {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash.clone())?;
                links_deleted.push(NodeLink {
                    src: link_tag_content.target_node_id,
                    dst: NodeId::Thing(input.thing_id.clone()),
                    tag: link_tag_content.tag,
                    create_action_hash: backlink_action_hash,
                });
            }
        }
        let links_to_things = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_things {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash.clone())?;
                links_deleted.push(NodeLink {
                    src: link_tag_content.target_node_id,
                    dst: NodeId::Thing(input.thing_id.clone()),
                    tag: link_tag_content.tag,
                    create_action_hash: backlink_action_hash,
                });
            }
        }
        let links_to_anchors = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_anchors {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash.clone())?;
                links_deleted.push(NodeLink {
                    src: link_tag_content.target_node_id,
                    dst: NodeId::Thing(input.thing_id.clone()),
                    tag: link_tag_content.tag,
                    create_action_hash: backlink_action_hash,
                });
            }
        }
    }

    // 3. Delete all links from the creator to the Thing
    if input.delete_links_from_creator {
        let creator = thing_record.action().author();
        let links_from_creator =
            get_links(GetLinksInputBuilder::try_new(creator.clone(), LinkTypes::ToAgent)?.build())?;
        for link in links_from_creator {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if link.target == input.thing_id.clone().into() {
                delete_link(link.create_link_hash.clone())?;
                links_deleted.push(NodeLink {
                    src: NodeId::Agent(creator.clone()),
                    dst: NodeId::Thing(input.thing_id.clone()),
                    tag: link_tag_content.tag,
                    create_action_hash: link.create_link_hash,
                });
            }
        }
    }

    // 3. Delete all links that are passed explicitly in the input
    // let all_to_links = get_links(input)
    if let Some(delete_links) = input.delete_links {
        let mut deleted_links = delete_links_from_node_inner(CreateOrDeleteLinksInput {
            src: NodeId::Thing(input.thing_id.clone()),
            links: delete_links,
        })?;
        links_deleted.append(&mut deleted_links);
    }

    // 4. Emit signals to the frontend
    emit_signal(Signal::Local(SignalKind::ThingDeleted {
        id: input.thing_id.clone(),
    }))?;
    emit_signal(Signal::Local(SignalKind::LinksDeleted {
        links: links_deleted,
    }))?;

    Ok(())
}

#[hdk_extern]
pub fn get_all_linked_node_ids(node_id: NodeId) -> ExternResult<Vec<NodeIdAndTag>> {
    let mut linked_node_ids: Vec<NodeIdAndTag> = Vec::new();
    let linked_thing_ids = get_linked_thing_ids(node_id.clone())?;
    for (thing_id, tag) in linked_thing_ids {
        let node = NodeId::Thing(thing_id);
        linked_node_ids.push(NodeIdAndTag { node_id: node, tag });
    }
    let linked_anchors = get_linked_anchors(node_id.clone())?;
    for (anchor, tag) in linked_anchors {
        let node = NodeId::Anchor(anchor);
        linked_node_ids.push(NodeIdAndTag { node_id: node, tag });
    }
    let linked_agents = get_linked_agents(node_id)?;
    for (agent, tag) in linked_agents {
        let node = NodeId::Agent(agent);
        linked_node_ids.push(NodeIdAndTag { node_id: node, tag });
    }
    Ok(linked_node_ids)
}

#[hdk_extern]
pub fn get_all_linked_nodes(node_id: NodeId) -> ExternResult<Vec<NodeContent>> {
    let mut linked_nodes: Vec<NodeContent> = Vec::new();
    let linked_things = get_linked_things(node_id.clone())?;
    for thing in linked_things {
        let node = NodeContent::Thing(thing);
        linked_nodes.push(node);
    }
    let linked_anchors = get_linked_anchors(node_id.clone())?;
    for (anchor, _) in linked_anchors {
        let node = NodeContent::Anchor(anchor);
        linked_nodes.push(node);
    }
    let linked_agents = get_linked_agents(node_id)?;
    for (agent, _) in linked_agents {
        let node = NodeContent::Agent(agent);
        linked_nodes.push(node);
    }
    Ok(linked_nodes)
}

#[hdk_extern]
pub fn get_linked_agents(node_id: NodeId) -> ExternResult<Vec<(AgentPubKey, Option<Vec<u8>>)>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToAgent)?.build())?;
    Ok(links
        .into_iter()
        .map(|l| {
            (
                l.target.into_agent_pub_key(),
                deserialize_link_tag(l.tag.0).ok(),
            )
        })
        .filter(|(maybe_agent, maybe_tag)| maybe_agent.is_some() && maybe_tag.is_some())
        .map(|(agent, tag)| (agent.unwrap(), tag.unwrap().tag))
        .collect())
}

#[hdk_extern]
pub fn get_linked_anchors(node_id: NodeId) -> ExternResult<Vec<(String, Option<Vec<u8>>)>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToAnchor)?.build())?;
    Ok(links
        .into_iter()
        .filter_map(|l| deserialize_link_tag(l.tag.0).ok())
        .map(|c| (anchor_string_from_node_id(c.target_node_id), c.tag))
        .filter(|(maybe_anchor, _)| maybe_anchor.is_some())
        .map(|(anchor, tag)| (anchor.unwrap(), tag))
        .collect())
}

/// Returns the linked thing ids together with the link tag
#[hdk_extern]
pub fn get_linked_thing_ids(node_id: NodeId) -> ExternResult<Vec<(ActionHash, Option<Vec<u8>>)>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToThing)?.build())?;
    Ok(links
        .into_iter()
        .map(|l| {
            (
                l.target.into_action_hash(),
                deserialize_link_tag(l.tag.0).ok(),
            )
        })
        .filter(|(maybe_action, maybe_tag)| maybe_action.is_some() && maybe_tag.is_some())
        .map(|(action, tag)| (action.unwrap(), tag.unwrap().tag))
        .collect())
}

#[hdk_extern]
pub fn get_linked_things(node_id: NodeId) -> ExternResult<Vec<Thing>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToThing)?.build())?;
    let mut latest_maybe_things: Vec<Option<Thing>> = Vec::new();
    for link in links {
        let maybe_thing_id = link.target.into_action_hash();
        if let Some(thing_id) = maybe_thing_id {
            let latest_thing = get_latest_thing(thing_id)?;
            latest_maybe_things.push(latest_thing);
        }
    }
    Ok(latest_maybe_things.into_iter().filter_map(|r| r).collect())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NodeAndLinkedIds {
    pub content: NodeContent,
    pub linked_node_ids: Vec<NodeIdAndTag>,
}

#[hdk_extern]
pub fn get_node_and_linked_node_ids(node_id: NodeId) -> ExternResult<Option<NodeAndLinkedIds>> {
    let maybe_node_content = match node_id.clone() {
        NodeId::Agent(a) => Some(NodeContent::Agent(a)),
        NodeId::Anchor(s) => Some(NodeContent::Anchor(s)),
        NodeId::Thing(thing_id) => {
            let thing = get_latest_thing(thing_id)?;
            match thing {
                Some(t) => Some(NodeContent::Thing(t)),
                _ => None,
            }
        }
    };
    if let Some(content) = maybe_node_content {
        let linked_node_ids = get_all_linked_node_ids(node_id)?;
        return Ok(Some(NodeAndLinkedIds {
            content,
            linked_node_ids,
        }));
    }
    Ok(None)
}

#[hdk_extern]
pub fn batch_get_node_and_linked_node_ids(
    nodes: Vec<NodeId>,
) -> ExternResult<Vec<NodeAndLinkedIds>> {
    let mut result: Vec<NodeAndLinkedIds> = Vec::new();
    for node_id in nodes {
        let maybe_node_content = match node_id.clone() {
            NodeId::Agent(a) => Some(NodeContent::Agent(a)),
            NodeId::Anchor(s) => Some(NodeContent::Anchor(s)),
            NodeId::Thing(thing_id) => {
                let thing = get_latest_thing(thing_id)?;
                match thing {
                    Some(t) => Some(NodeContent::Thing(t)),
                    _ => None,
                }
            }
        };
        if let Some(content) = maybe_node_content {
            let linked_node_ids = get_all_linked_node_ids(node_id)?;
            result.push(NodeAndLinkedIds {
                content,
                linked_node_ids,
            });
        }
    }
    Ok(result)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CreateOrDeleteLinksInput {
    pub src: NodeId,
    pub links: Vec<LinkInput>,
}

#[hdk_extern]
pub fn create_links_from_node(input: CreateOrDeleteLinksInput) -> ExternResult<()> {
    let mut links_created: Vec<NodeLink> = Vec::new();
    for link in input.links {
        let (node_link, maybe_backlink) =
            create_link_from_node_by_id(input.src.clone(), link.clone())?;
        links_created.push(node_link);
        if let Some(backlink) = maybe_backlink {
            links_created.push(backlink);
        }
    }
    emit_signal(Signal::Local(SignalKind::LinksCreated {
        links: links_created,
    }))?;
    Ok(())
}

#[hdk_extern]
pub fn delete_links_from_node(input: CreateOrDeleteLinksInput) -> ExternResult<()> {
    let links_deleted = delete_links_from_node_inner(input)?;

    // Emit signals about deleted links to the frontend
    emit_signal(Signal::Local(SignalKind::LinksCreated {
        links: links_deleted,
    }))?;

    Ok(())
}

fn delete_links_from_node_inner(input: CreateOrDeleteLinksInput) -> ExternResult<Vec<NodeLink>> {
    let base = linkable_hash_from_node_id(input.src.clone())?;

    let mut links_deleted: Vec<NodeLink> = Vec::new();

    let anchor_link_inputs = input
        .links
        .clone()
        .into_iter()
        .map(|l| match l.node_id {
            NodeId::Agent(_) => Some(l),
            _ => None,
        })
        .filter_map(|l| l)
        .collect::<Vec<LinkInput>>();

    let agent_link_inputs = input
        .links
        .clone()
        .into_iter()
        .map(|l| match l.node_id {
            NodeId::Agent(_) => Some(l),
            _ => None,
        })
        .filter_map(|l| l)
        .collect::<Vec<LinkInput>>();

    let thing_link_inputs = input
        .links
        .clone()
        .into_iter()
        .map(|l| match l.node_id {
            NodeId::Agent(_) => Some(l),
            _ => None,
        })
        .filter_map(|l| l)
        .collect::<Vec<LinkInput>>();

    if anchor_link_inputs.len() > 0 {
        for link_input in anchor_link_inputs {
            let links_to_anchors = get_links(
                GetLinksInputBuilder::try_new(base.clone(), LinkTypes::ToAnchor)?.build(),
            )?;
            for link in links_to_anchors {
                let target = linkable_hash_from_node_id(link_input.node_id.clone())?;
                let link_tag_content = deserialize_link_tag(link.tag.0)?;
                if target == link.target && link_input.tag == link_tag_content.tag {
                    if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                        delete_link(backlink_action_hash.clone())?;
                        links_deleted.push(NodeLink {
                            src: link_tag_content.target_node_id,
                            dst: input.src.clone(),
                            tag: link_tag_content.tag,
                            create_action_hash: backlink_action_hash,
                        });
                    }
                    delete_link(link.create_link_hash.clone())?;
                    links_deleted.push(NodeLink {
                        src: input.src.clone(),
                        dst: link_input.node_id.clone(),
                        tag: link_input.tag.clone(),
                        create_action_hash: link.create_link_hash,
                    });
                }
            }
        }
    }

    if agent_link_inputs.len() > 0 {
        for link_input in agent_link_inputs {
            let links_to_agents = get_links(
                GetLinksInputBuilder::try_new(base.clone(), LinkTypes::ToAgent)?.build(),
            )?;
            for link in links_to_agents {
                let target = linkable_hash_from_node_id(link_input.node_id.clone())?;
                let link_tag_content = deserialize_link_tag(link.tag.0)?;
                if target == link.target && link_input.tag == link_tag_content.tag {
                    if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                        delete_link(backlink_action_hash.clone())?;
                        links_deleted.push(NodeLink {
                            src: link_tag_content.target_node_id,
                            dst: input.src.clone(),
                            tag: link_tag_content.tag,
                            create_action_hash: backlink_action_hash,
                        });
                    }
                    delete_link(link.create_link_hash.clone())?;
                    links_deleted.push(NodeLink {
                        src: input.src.clone(),
                        dst: link_input.node_id.clone(),
                        tag: link_input.tag.clone(),
                        create_action_hash: link.create_link_hash,
                    });
                }
            }
        }
    }

    if thing_link_inputs.len() > 0 {
        for link_input in thing_link_inputs {
            let links_to_things = get_links(
                GetLinksInputBuilder::try_new(base.clone(), LinkTypes::ToThing)?.build(),
            )?;
            for link in links_to_things {
                let target = linkable_hash_from_node_id(link_input.node_id.clone())?;
                let link_tag_content = deserialize_link_tag(link.tag.0)?;
                if target == link.target && link_input.tag == link_tag_content.tag {
                    if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                        delete_link(backlink_action_hash.clone())?;
                        links_deleted.push(NodeLink {
                            src: link_tag_content.target_node_id,
                            dst: input.src.clone(),
                            tag: link_tag_content.tag,
                            create_action_hash: backlink_action_hash,
                        });
                    }
                    delete_link(link.create_link_hash.clone())?;
                    links_deleted.push(NodeLink {
                        src: input.src.clone(),
                        dst: link_input.node_id.clone(),
                        tag: link_input.tag.clone(),
                        create_action_hash: link.create_link_hash,
                    });
                }
            }
        }
    }

    Ok(links_deleted)
}

fn create_link_from_node_by_id(
    src: NodeId,
    link: LinkInput,
) -> ExternResult<(NodeLink, Option<NodeLink>)> {
    let base: HoloHash<hash_type::AnyLinkable> = linkable_hash_from_node_id(src.clone())?;
    match link.node_id.clone() {
        NodeId::Agent(agent) => match link.direction {
            LinkDirection::To => {
                let ah = create_link(
                    base.clone(),
                    agent,
                    LinkTypes::ToAgent,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                Ok((
                    NodeLink {
                        src,
                        dst: link.node_id,
                        tag: link.tag,
                        create_action_hash: ah,
                    },
                    None,
                ))
            }
            LinkDirection::From => {
                let ah = create_link(
                    agent,
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                Ok((
                    NodeLink {
                        src,
                        dst: link.node_id,
                        tag: link.tag,
                        create_action_hash: ah,
                    },
                    None,
                ))
            }
            LinkDirection::Bidirectional => {
                let backlink_action_hash = create_link(
                    agent.clone(),
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                let ah = create_link(
                    base.clone(),
                    agent,
                    LinkTypes::ToAgent,
                    derive_link_tag(
                        link.tag.clone(),
                        Some(backlink_action_hash.clone()),
                        src.clone(),
                    )?,
                )?;
                Ok((
                    NodeLink {
                        src: src.clone(),
                        dst: link.node_id.clone(),
                        tag: link.tag.clone(),
                        create_action_hash: ah,
                    },
                    Some(NodeLink {
                        src: link.node_id,
                        dst: src,
                        tag: link.tag,
                        create_action_hash: backlink_action_hash,
                    }),
                ))
            }
        },
        NodeId::Anchor(anchor) => {
            let path = Path::from(anchor.clone());
            let path_entry_hash = path.path_entry_hash()?;
            match link.direction {
                LinkDirection::To => {
                    let ah = create_link(
                        base.clone(),
                        path_entry_hash,
                        LinkTypes::ToAgent,
                        derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                    )?;
                    Ok((
                        NodeLink {
                            src,
                            dst: link.node_id,
                            tag: link.tag,
                            create_action_hash: ah,
                        },
                        None,
                    ))
                }
                LinkDirection::From => {
                    let ah = create_link(
                        path_entry_hash,
                        base.clone(),
                        LinkTypes::ToThing,
                        derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                    )?;
                    Ok((
                        NodeLink {
                            src,
                            dst: link.node_id,
                            tag: link.tag,
                            create_action_hash: ah,
                        },
                        None,
                    ))
                }
                LinkDirection::Bidirectional => {
                    let backlink_action_hash = create_link(
                        path_entry_hash.clone(),
                        base.clone(),
                        LinkTypes::ToThing,
                        derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                    )?;
                    let ah = create_link(
                        base.clone(),
                        path_entry_hash,
                        LinkTypes::ToAgent,
                        derive_link_tag(
                            link.tag.clone(),
                            Some(backlink_action_hash.clone()),
                            src.clone(),
                        )?,
                    )?;
                    Ok((
                        NodeLink {
                            src: src.clone(),
                            dst: link.node_id.clone(),
                            tag: link.tag.clone(),
                            create_action_hash: ah,
                        },
                        Some(NodeLink {
                            src: link.node_id,
                            dst: src,
                            tag: link.tag,
                            create_action_hash: backlink_action_hash,
                        }),
                    ))
                }
            }
        }
        NodeId::Thing(action_hash) => match link.direction {
            LinkDirection::To => {
                let ah = create_link(
                    base.clone(),
                    action_hash,
                    LinkTypes::ToAgent,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                Ok((
                    NodeLink {
                        src,
                        dst: link.node_id,
                        tag: link.tag,
                        create_action_hash: ah,
                    },
                    None,
                ))
            }
            LinkDirection::From => {
                let ah = create_link(
                    action_hash,
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                Ok((
                    NodeLink {
                        src,
                        dst: link.node_id,
                        tag: link.tag,
                        create_action_hash: ah,
                    },
                    None,
                ))
            }
            LinkDirection::Bidirectional => {
                let backlink_action_hash = create_link(
                    action_hash.clone(),
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                let ah = create_link(
                    base.clone(),
                    action_hash,
                    LinkTypes::ToAgent,
                    derive_link_tag(
                        link.tag.clone(),
                        Some(backlink_action_hash.clone()),
                        src.clone(),
                    )?,
                )?;
                Ok((
                    NodeLink {
                        src: src.clone(),
                        dst: link.node_id.clone(),
                        tag: link.tag.clone(),
                        create_action_hash: ah,
                    },
                    Some(NodeLink {
                        src: link.node_id,
                        dst: src,
                        tag: link.tag,
                        create_action_hash: backlink_action_hash,
                    }),
                ))
            }
        },
    }
}

fn linkable_hash_from_node_id(node_id: NodeId) -> ExternResult<AnyLinkableHash> {
    match node_id {
        NodeId::Agent(a) => Ok(a.into()),
        NodeId::Anchor(a) => Ok(Path::from(a).path_entry_hash()?.into()),
        NodeId::Thing(a) => Ok(a.into()),
    }
}

fn derive_link_tag(
    input: Option<Vec<u8>>,
    backlink_action_hash: Option<ActionHash>,
    target_node_id: NodeId,
) -> ExternResult<LinkTag> {
    let link_tag_content = LinkTagContent {
        tag: input,
        backlink_action_hash,
        target_node_id,
    };
    let serialized_content = serialize_link_tag(link_tag_content)?;
    Ok(LinkTag::from(serialized_content))
}

fn thing_record_to_thing(record: Record) -> ExternResult<Thing> {
    let thing_entry = record
    .entry()
    .to_app_option::<ThingEntry>()
    .map_err(|e| {
        wasm_error!(WasmErrorInner::Guest(
            format!("Failed to deserialize Record at the given action hash (thing_id) to a ThingEntry: {e}")
        ))
    })?
    .ok_or(wasm_error!(WasmErrorInner::Guest(
        "No Thing associated to this thing id (AcionHash).".into()
    )))?;
    Ok(Thing {
        id: record.action_address().clone(),
        content: thing_entry.content,
        creator: record.action().author().clone(),
        created_at: record.action().timestamp(),
        updated_at: None,
    })
}

fn anchor_string_from_node_id(node_id: NodeId) -> Option<String> {
    match node_id {
        NodeId::Anchor(s) => Some(s),
        _ => None,
    }
}
