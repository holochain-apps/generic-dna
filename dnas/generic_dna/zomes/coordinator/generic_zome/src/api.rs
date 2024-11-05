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
pub enum Node {
    Agent(AgentPubKey),
    Anchor(String),
    Thing(Thing),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinkInput {
    pub direction: LinkDirection,
    pub node_id: NodeId,
    pub tag: Option<Vec<u8>>,
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
                create_link_from_node_by_id(NodeId::Thing(thing_id.clone()), link.clone())?;
                links_created.push(NodeLink {
                    src: NodeId::Thing(thing_id.clone()),
                    dst: link.node_id.clone(),
                });
                if let LinkDirection::Bidirectional = link.direction {
                    links_created.push(NodeLink {
                        src: link.node_id,
                        dst: NodeId::Thing(thing_id.clone()),
                    });
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

    create_link(
        input.thing_id.clone(),
        updated_thing_hash,
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
                delete_link(backlink_action_hash)?;
                links_deleted.push(NodeLink {
                    src: link_tag_content.target_node_id,
                    dst: NodeId::Thing(input.thing_id.clone()),
                });
            }
        }
        let links_to_things = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_things {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash)?;
                links_deleted.push(NodeLink {
                    src: link_tag_content.target_node_id,
                    dst: NodeId::Thing(input.thing_id.clone()),
                });
            }
        }
        let links_to_anchors = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_anchors {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash)?;
                links_deleted.push(NodeLink {
                    src: link_tag_content.target_node_id,
                    dst: NodeId::Thing(input.thing_id.clone()),
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
            if link.target == input.thing_id.clone().into() {
                delete_link(link.create_link_hash)?;
                links_deleted.push(NodeLink {
                    src: NodeId::Agent(creator.clone()),
                    dst: NodeId::Thing(input.thing_id.clone()),
                });
            }
        }
    }

    // 3. Delete all links that are passed explicitly in the input
    // let all_to_links = get_links(input)
    if let Some(delete_links) = input.delete_links {
        let to_links_to_delete = delete_links
            .clone()
            .into_iter()
            .map(|l| match l.direction {
                LinkDirection::To => Some(l),
                _ => None,
            })
            .filter_map(|l| l)
            .collect::<Vec<LinkInput>>();

        // We save ourselves the get_links below if there are no LinkInput with LinkDirection::To
        if to_links_to_delete.len() > 0 {
            let links = get_links(
                GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
            )?;
            for to_link in to_links_to_delete {
                match to_link.direction {
                    LinkDirection::To => match to_link.node_id {
                        NodeId::Agent(agent) => {
                            delete_links_with_target(&links, agent.into())?;
                        }
                        NodeId::Anchor(anchor) => {
                            let path = Path::from(anchor);
                            let path_entry_hash = path.path_entry_hash()?;
                            delete_links_with_target(&links, path_entry_hash.into())?;
                        }
                        NodeId::Thing(action_hash) => {
                            delete_links_with_target(&links, action_hash.into())?;
                        }
                    },
                    _ => (),
                }
            }
        }

        for link_to_delete in delete_links {
            match link_to_delete.direction {
                LinkDirection::To => (), // We already handled this above if any LinkInput with Linkdirection::To is present
                LinkDirection::From | LinkDirection::Bidirectional => {
                    // In this case delete all links pointing towards the Thing to delete
                    // We don't care to delete the links pointing away from the Thing in case
                    // of a bidirectional link, since we assume that such links will not
                    // be discoverabke anymore anyway once the Thing as been deleted
                    match link_to_delete.node_id {
                        NodeId::Agent(agent) => {
                            delete_links_for_base_with_target(
                                agent.clone().into(),
                                input.thing_id.clone().into(),
                                LinkTypes::ToThing,
                            )?;
                            // If multiple links got deleted with the same base and target we assume that
                            // they get deduplicated in the frontend anyway so we only push it once
                            links_deleted.push(NodeLink {
                                src: NodeId::Agent(agent),
                                dst: NodeId::Thing(input.thing_id.clone()),
                            });
                        }
                        NodeId::Anchor(anchor) => {
                            let path = Path::from(anchor.clone());
                            let path_entry_hash = path.path_entry_hash()?;
                            delete_links_for_base_with_target(
                                path_entry_hash.into(),
                                input.thing_id.clone().into(),
                                LinkTypes::ToThing,
                            )?;
                            links_deleted.push(NodeLink {
                                src: NodeId::Anchor(anchor),
                                dst: NodeId::Thing(input.thing_id.clone()),
                            });
                        }
                        NodeId::Thing(action_hash) => {
                            delete_links_for_base_with_target(
                                action_hash.clone().into(),
                                input.thing_id.clone().into(),
                                LinkTypes::ToThing,
                            )?;
                            links_deleted.push(NodeLink {
                                src: NodeId::Thing(action_hash),
                                dst: NodeId::Thing(input.thing_id.clone()),
                            });
                        }
                    }
                }
            }
        }
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
pub fn get_all_linked_node_ids(node_id: NodeId) -> ExternResult<Vec<NodeId>> {
    let mut linked_node_ids: Vec<NodeId> = Vec::new();
    let linked_thing_ids = get_linked_thing_ids(node_id.clone())?;
    for thing_id in linked_thing_ids {
        let node = NodeId::Thing(thing_id);
        linked_node_ids.push(node);
    }
    let linked_anchors = get_linked_anchors(node_id.clone())?;
    for anchor in linked_anchors {
        let node = NodeId::Anchor(anchor);
        linked_node_ids.push(node);
    }
    let linked_agents = get_linked_agents(node_id)?;
    for agent in linked_agents {
        let node = NodeId::Agent(agent);
        linked_node_ids.push(node);
    }
    Ok(linked_node_ids)
}

#[hdk_extern]
pub fn get_all_linked_nodes(node_id: NodeId) -> ExternResult<Vec<Node>> {
    let mut linked_nodes: Vec<Node> = Vec::new();
    let linked_things = get_linked_things(node_id.clone())?;
    for thing in linked_things {
        let node = Node::Thing(thing);
        linked_nodes.push(node);
    }
    let linked_anchors = get_linked_anchors(node_id.clone())?;
    for anchor in linked_anchors {
        let node = Node::Anchor(anchor);
        linked_nodes.push(node);
    }
    let linked_agents = get_linked_agents(node_id)?;
    for agent in linked_agents {
        let node = Node::Agent(agent);
        linked_nodes.push(node);
    }
    Ok(linked_nodes)
}

#[hdk_extern]
pub fn get_linked_agents(node_id: NodeId) -> ExternResult<Vec<AgentPubKey>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToAgent)?.build())?;
    Ok(links
        .into_iter()
        .map(|l| l.target.into_agent_pub_key())
        .filter_map(|a| a)
        .collect())
}

#[hdk_extern]
pub fn get_linked_anchors(node_id: NodeId) -> ExternResult<Vec<String>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToAnchor)?.build())?;
    Ok(links
        .into_iter()
        .map(|l| deserialize_link_tag(l.tag.0).ok())
        .filter_map(|c| c)
        .map(|c| anchor_string_from_node_id(c.target_node_id))
        .filter_map(|a| a)
        .collect())
}

#[hdk_extern]
pub fn get_linked_thing_ids(node_id: NodeId) -> ExternResult<Vec<ActionHash>> {
    let base = linkable_hash_from_node_id(node_id)?;
    let links = get_links(GetLinksInputBuilder::try_new(base, LinkTypes::ToThing)?.build())?;
    Ok(links
        .into_iter()
        .map(|l| l.target.into_action_hash())
        .filter_map(|r| r)
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
pub struct CreateOrDeleteLinksInput {
    pub src: NodeId,
    pub links: Vec<LinkInput>,
}

#[hdk_extern]
pub fn create_links_from_node(input: CreateOrDeleteLinksInput) -> ExternResult<()> {
    let mut links_created: Vec<NodeLink> = Vec::new();
    for link in input.links {
        create_link_from_node_by_id(input.src.clone(), link.clone())?;
        links_created.push(NodeLink {
            src: input.src.clone(),
            dst: link.node_id.clone(),
        });
        if let LinkDirection::Bidirectional = link.direction {
            links_created.push(NodeLink {
                src: link.node_id,
                dst: input.src.clone(),
            });
        }
    }
    emit_signal(Signal::Local(SignalKind::LinksCreated {
        links: links_created,
    }))?;
    Ok(())
}

#[hdk_extern]
pub fn delete_links_from_node(input: CreateOrDeleteLinksInput) -> ExternResult<()> {
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
                        delete_link(backlink_action_hash)?;
                        links_deleted.push(NodeLink {
                            src: link_tag_content.target_node_id,
                            dst: input.src.clone(),
                        });
                    }
                    delete_link(link.create_link_hash)?;
                    links_deleted.push(NodeLink {
                        src: input.src.clone(),
                        dst: link_input.node_id.clone(),
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
                        delete_link(backlink_action_hash)?;
                        links_deleted.push(NodeLink {
                            src: link_tag_content.target_node_id,
                            dst: input.src.clone(),
                        });
                    }
                    delete_link(link.create_link_hash)?;
                    links_deleted.push(NodeLink {
                        src: input.src.clone(),
                        dst: link_input.node_id.clone(),
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
                        delete_link(backlink_action_hash)?;
                        links_deleted.push(NodeLink {
                            src: link_tag_content.target_node_id,
                            dst: input.src.clone(),
                        });
                    }
                    delete_link(link.create_link_hash)?;
                    links_deleted.push(NodeLink {
                        src: input.src.clone(),
                        dst: link_input.node_id.clone(),
                    });
                }
            }
        }
    }

    // Emit signals about deleted links to the frontend
    emit_signal(Signal::Local(SignalKind::LinksCreated {
        links: links_deleted,
    }))?;

    Ok(())
}

fn create_link_from_node_by_id(src: NodeId, link: LinkInput) -> ExternResult<()> {
    let base: HoloHash<hash_type::AnyLinkable> = linkable_hash_from_node_id(src.clone())?;
    match link.node_id.clone() {
        NodeId::Agent(agent) => match link.direction {
            LinkDirection::To => {
                create_link(
                    base.clone(),
                    agent,
                    LinkTypes::ToAgent,
                    derive_link_tag(link.tag, None, link.node_id.clone())?,
                )?;
            }
            LinkDirection::From => {
                create_link(
                    agent,
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag, None, link.node_id.clone())?,
                )?;
            }
            LinkDirection::Bidirectional => {
                let backlink_action_hash = create_link(
                    agent.clone(),
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                create_link(
                    base.clone(),
                    agent,
                    LinkTypes::ToAgent,
                    derive_link_tag(link.tag, Some(backlink_action_hash), src.clone())?,
                )?;
            }
        },
        NodeId::Anchor(anchor) => {
            let path = Path::from(anchor.clone());
            let path_entry_hash = path.path_entry_hash()?;
            match link.direction {
                LinkDirection::To => {
                    create_link(
                        base.clone(),
                        path_entry_hash,
                        LinkTypes::ToAgent,
                        derive_link_tag(link.tag, None, link.node_id.clone())?,
                    )?;
                }
                LinkDirection::From => {
                    create_link(
                        path_entry_hash,
                        base.clone(),
                        LinkTypes::ToThing,
                        derive_link_tag(link.tag, None, link.node_id.clone())?,
                    )?;
                }
                LinkDirection::Bidirectional => {
                    let backlink_action_hash = create_link(
                        path_entry_hash.clone(),
                        base.clone(),
                        LinkTypes::ToThing,
                        derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                    )?;
                    create_link(
                        base.clone(),
                        path_entry_hash,
                        LinkTypes::ToAgent,
                        derive_link_tag(link.tag, Some(backlink_action_hash), src.clone())?,
                    )?;
                }
            }
        }
        NodeId::Thing(action_hash) => match link.direction {
            LinkDirection::To => {
                create_link(
                    base.clone(),
                    action_hash,
                    LinkTypes::ToAgent,
                    derive_link_tag(link.tag, None, link.node_id.clone())?,
                )?;
            }
            LinkDirection::From => {
                create_link(
                    action_hash,
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag, None, link.node_id.clone())?,
                )?;
            }
            LinkDirection::Bidirectional => {
                let backlink_action_hash = create_link(
                    action_hash.clone(),
                    base.clone(),
                    LinkTypes::ToThing,
                    derive_link_tag(link.tag.clone(), None, link.node_id.clone())?,
                )?;
                create_link(
                    base.clone(),
                    action_hash,
                    LinkTypes::ToAgent,
                    derive_link_tag(link.tag, Some(backlink_action_hash), src.clone())?,
                )?;
            }
        },
    }
    Ok(())
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

/// Deletes all links for a base that are pointing to the given target
fn delete_links_for_base_with_target(
    base: AnyLinkableHash,
    target: AnyLinkableHash,
    link_type: LinkTypes,
) -> ExternResult<()> {
    let links = get_links(GetLinksInputBuilder::try_new(base, link_type)?.build())?;
    for link in links {
        if link.target == target {
            delete_link(link.create_link_hash)?;
        }
    }
    Ok(())
}

fn delete_links_with_target(links: &Vec<Link>, target: AnyLinkableHash) -> ExternResult<()> {
    for link in links {
        if link.target == target {
            delete_link(link.create_link_hash.clone())?;
        }
    }
    Ok(())
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
