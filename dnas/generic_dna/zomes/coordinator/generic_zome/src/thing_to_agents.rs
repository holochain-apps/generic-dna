use generic_zome_integrity::*;
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct AddAgentForThingInput {
    pub base_thing_hash: ActionHash,
    pub target_agent: AgentPubKey,
}

#[hdk_extern]
pub fn add_agent_for_thing(input: AddAgentForThingInput) -> ExternResult<()> {
    create_link(
        input.base_thing_hash.clone(),
        input.target_agent.clone(),
        LinkTypes::ThingToAgents,
        (),
    )?;
    Ok(())
}

#[hdk_extern]
pub fn get_agents_for_thing(thing_hash: ActionHash) -> ExternResult<Vec<Link>> {
    get_links(GetLinksInputBuilder::try_new(thing_hash, LinkTypes::ThingToAgents)?.build())
}

#[hdk_extern]
pub fn get_deleted_agents_for_thing(
    thing_hash: ActionHash,
) -> ExternResult<Vec<(SignedActionHashed, Vec<SignedActionHashed>)>> {
    let details = get_link_details(
        thing_hash,
        LinkTypes::ThingToAgents,
        None,
        GetOptions::default(),
    )?;
    Ok(details
        .into_inner()
        .into_iter()
        .filter(|(_link, deletes)| !deletes.is_empty())
        .collect())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoveAgentForThingInput {
    pub base_thing_hash: ActionHash,
    pub target_agent: AgentPubKey,
}

#[hdk_extern]
pub fn delete_agent_for_thing(input: RemoveAgentForThingInput) -> ExternResult<()> {
    let links = get_links(
        GetLinksInputBuilder::try_new(input.base_thing_hash.clone(), LinkTypes::ThingToAgents)?
            .build(),
    )?;
    for link in links {
        if AgentPubKey::from(link.target.clone().into_entry_hash().ok_or(wasm_error!(
            WasmErrorInner::Guest("No entry_hash associated with link".to_string())
        ))?) == input.target_agent.clone().into_hash().into()
        {
            delete_link(link.create_link_hash)?;
        }
    }
    Ok(())
}
