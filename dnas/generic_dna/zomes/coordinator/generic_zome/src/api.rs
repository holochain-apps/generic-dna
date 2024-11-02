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
#[serde(tag = "type")]
pub enum NodeId {
    Agent(AgentPubKey),
    Anchor(String),
    Thing(ActionHash),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum Node {
    Agent(AgentPubKey),
    Anchor(String),
    Thing(ThingEntry),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinkInput {
    pub direction: LinkDirection,
    pub node_id: NodeId,
    pub tag: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Thing {
    pub id: ActionHash,
    pub content: String,
    pub creator: AgentPubKey,
    pub created_at: Timestamp,
    pub updated_at: Option<Timestamp>,
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

    // 2. Create all links as necessary
    match input.links {
        Some(links) => {
            for link in links {
                match link.node_id {
                    NodeId::Agent(agent) => match link.direction {
                        LinkDirection::To => {
                            create_link(
                                thing_id.clone(),
                                agent,
                                LinkTypes::ToAgent,
                                derive_link_tag(link.tag, None)?,
                            )?;
                        }
                        LinkDirection::From => {
                            create_link(
                                agent,
                                thing_id.clone(),
                                LinkTypes::ToThing,
                                derive_link_tag(link.tag, None)?,
                            )?;
                        }
                        LinkDirection::Bidirectional => {
                            let backlink_action_hash = create_link(
                                agent.clone(),
                                thing_id.clone(),
                                LinkTypes::ToThing,
                                derive_link_tag(link.tag.clone(), None)?,
                            )?;
                            create_link(
                                thing_id.clone(),
                                agent,
                                LinkTypes::ToAgent,
                                derive_link_tag(link.tag, Some(backlink_action_hash))?,
                            )?;
                        }
                    },
                    NodeId::Anchor(anchor) => {
                        let path = Path::from(anchor);
                        let path_entry_hash = path.path_entry_hash()?;
                        match link.direction {
                            LinkDirection::To => {
                                create_link(
                                    thing_id.clone(),
                                    path_entry_hash,
                                    LinkTypes::ToAgent,
                                    derive_link_tag(link.tag, None)?,
                                )?;
                            }
                            LinkDirection::From => {
                                create_link(
                                    path_entry_hash,
                                    thing_id.clone(),
                                    LinkTypes::ToThing,
                                    derive_link_tag(link.tag, None)?,
                                )?;
                            }
                            LinkDirection::Bidirectional => {
                                let backlink_action_hash = create_link(
                                    path_entry_hash.clone(),
                                    thing_id.clone(),
                                    LinkTypes::ToThing,
                                    derive_link_tag(link.tag.clone(), None)?,
                                )?;
                                create_link(
                                    thing_id.clone(),
                                    path_entry_hash,
                                    LinkTypes::ToAgent,
                                    derive_link_tag(link.tag, Some(backlink_action_hash))?,
                                )?;
                            }
                        }
                    }
                    NodeId::Thing(action_hash) => match link.direction {
                        LinkDirection::To => {
                            create_link(
                                thing_id.clone(),
                                action_hash,
                                LinkTypes::ToAgent,
                                derive_link_tag(link.tag, None)?,
                            )?;
                        }
                        LinkDirection::From => {
                            create_link(
                                action_hash,
                                thing_id.clone(),
                                LinkTypes::ToThing,
                                derive_link_tag(link.tag, None)?,
                            )?;
                        }
                        LinkDirection::Bidirectional => {
                            let backlink_action_hash = create_link(
                                action_hash.clone(),
                                thing_id.clone(),
                                LinkTypes::ToThing,
                                derive_link_tag(link.tag.clone(), None)?,
                            )?;
                            create_link(
                                thing_id.clone(),
                                action_hash,
                                LinkTypes::ToAgent,
                                derive_link_tag(link.tag, Some(backlink_action_hash))?,
                            )?;
                        }
                    },
                }
            }
        }
        None => (),
    }

    Ok(Thing {
        id: thing_id,
        content: input.content,
        creator: thing_record.action().author().clone(),
        created_at: thing_record.action().timestamp(),
        updated_at: None,
    })
}

#[hdk_extern]
pub fn get_latest_thing(thing_id: ActionHash) -> ExternResult<Option<Record>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(thing_id.clone(), LinkTypes::ThingUpdates)?.build(),
    )?;
    let latest_link = links
        .into_iter()
        .max_by(|link_a, link_b| link_a.timestamp.cmp(&link_b.timestamp));
    let latest_thing_hash = match latest_link {
        Some(link) => {
            link.target
                .clone()
                .into_action_hash()
                .ok_or(wasm_error!(WasmErrorInner::Guest(
                    "No action hash associated with link".to_string()
                )))?
        }
        None => thing_id.clone(),
    };
    get(latest_thing_hash, GetOptions::default())
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

    Ok(Thing {
        id: input.thing_id,
        content: input.updated_content,
        creator: thing_record.action().author().clone(),
        created_at: thing_record.action().timestamp(),
        updated_at: Some(updated_thing_record.action().timestamp()),
    })
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
            }
        }
        let links_to_things = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_things {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash)?;
            }
        }
        let links_to_anchors = get_links(
            GetLinksInputBuilder::try_new(input.thing_id.clone(), LinkTypes::ToAgent)?.build(),
        )?;
        for link in links_to_anchors {
            let link_tag_content = deserialize_link_tag(link.tag.0)?;
            if let Some(backlink_action_hash) = link_tag_content.backlink_action_hash {
                delete_link(backlink_action_hash)?;
            }
        }
    }

    // 3. Delete all links from the creator to the Thing
    if input.delete_links_from_creator {
        let links_from_creator = get_links(
            GetLinksInputBuilder::try_new(
                thing_record.action().author().clone(),
                LinkTypes::ToAgent,
            )?
            .build(),
        )?;
        for link in links_from_creator {
            if link.target == input.thing_id.clone().into() {
                delete_link(link.create_link_hash)?;
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
                                agent.into(),
                                input.thing_id.clone().into(),
                                LinkTypes::ToThing,
                            )?;
                        }
                        NodeId::Anchor(anchor) => {
                            let path = Path::from(anchor);
                            let path_entry_hash = path.path_entry_hash()?;
                            delete_links_for_base_with_target(
                                path_entry_hash.into(),
                                input.thing_id.clone().into(),
                                LinkTypes::ToThing,
                            )?;
                        }
                        NodeId::Thing(action_hash) => {
                            delete_links_for_base_with_target(
                                action_hash.into(),
                                input.thing_id.clone().into(),
                                LinkTypes::ToThing,
                            )?;
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

fn derive_link_tag(
    input: Option<Vec<u8>>,
    backlink_action_hash: Option<ActionHash>,
) -> ExternResult<LinkTag> {
    let link_tag_content = LinkTagContent {
        tag: input,
        backlink_action_hash,
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
