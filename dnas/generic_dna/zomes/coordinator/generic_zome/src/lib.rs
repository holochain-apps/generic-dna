pub mod api;
use generic_zome_integrity::*;
use hdk::prelude::*;

/// Called the first time a zome call is made to the cell containing this zome
#[hdk_extern]
pub fn init() -> ExternResult<InitCallbackResult> {
    let mut functions = BTreeSet::new();
    functions.insert((zome_info()?.name, FunctionName("recv_remote_signal".into())));
    let cap_grant_entry: CapGrantEntry = CapGrantEntry::new(
        String::from("remote signals"), // A string by which to later query for saved grants.
        ().into(), // Unrestricted access means any external agent can call the extern
        GrantedFunctions::Listed(functions),
    );

    create_cap_grant(cap_grant_entry)?;

    // register own public key on global anchor
    add_agent_to_anchor(())?;
    Ok(InitCallbackResult::Pass)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct NodeLink {
    src: NodeId,
    dst: NodeId,
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
#[serde(tag = "type", content = "content")]
pub enum Signal {
    Local(SignalKind),
    Remote(SignalKind),
}

/// Don't modify this enum if you want the scaffolding tool to generate appropriate signals for your entries and links
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum SignalKind {
    ThingCreated { thing: Thing },
    ThingUpdated { thing: Thing },
    ThingDeleted { id: ActionHash },
    LinksCreated { links: Vec<NodeLink> },
    LinksDeleted { links: Vec<NodeLink> },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoteSignal {
    signal: Signal,
}

#[hdk_extern]
pub fn recv_remote_signal(signal: ExternIO) -> ExternResult<()> {
    let signal_payload: Signal = signal.decode().map_err(|err| {
        wasm_error!(WasmErrorInner::Guest(format!(
            "Failed to deserialize remote signal payload: {}",
            err
        )))
    })?;

    emit_signal(signal_payload)?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoteSignalInput {
    pub signal: Signal,
    pub agents: Vec<AgentPubKey>,
}

#[hdk_extern]
pub fn remote_signal(input: RemoteSignalInput) -> ExternResult<()> {
    if let Signal::Remote(_) = input.signal {
        let encoded_signal = ExternIO::encode(input.signal)
            .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;
        send_remote_signal(encoded_signal, input.agents)?;
    }
    Ok(())
}

pub const SIMPLE_HOLOCHAIN_ALL_AGENTS: &str = "SIMPLE_HOLOCHAIN_ALL_AGENTS";

#[hdk_extern]
pub fn add_agent_to_anchor(_: ()) -> ExternResult<ActionHash> {
    let path = Path::from(SIMPLE_HOLOCHAIN_ALL_AGENTS);
    create_link(
        path.path_entry_hash()?,
        agent_info()?.agent_initial_pubkey,
        LinkTypes::ToAgent,
        (),
    )
}

// /// Whenever an action is committed, we emit a signal to the UI elements to reactively update them
// #[hdk_extern(infallible)]
// pub fn post_commit(committed_actions: Vec<SignedActionHashed>) {
//     /// Don't modify this loop if you want the scaffolding tool to generate appropriate signals for your entries and links
//     for action in committed_actions {
//         if let Err(err) = signal_action(action) {
//             error!("Error signaling new action: {:?}", err);
//         }
//     }
// }

// /// Don't modify this function if you want the scaffolding tool to generate appropriate signals for your entries and links
// fn signal_action(action: SignedActionHashed) -> ExternResult<()> {
//     match action.hashed.content.clone() {
//         Action::CreateLink(create_link) => {
//             if let Ok(Some(link_type)) =
//                 LinkTypes::from_type(create_link.zome_index, create_link.link_type)
//             {
//                 emit_signal(Signal::LinkCreated { action, link_type })?;
//             }
//             Ok(())
//         }
//         Action::DeleteLink(delete_link) => {
//             let record = get(delete_link.link_add_address.clone(), GetOptions::default())?.ok_or(
//                 wasm_error!(WasmErrorInner::Guest(
//                     "Failed to fetch CreateLink action".to_string()
//                 )),
//             )?;
//             match record.action() {
//                 Action::CreateLink(create_link) => {
//                     if let Ok(Some(link_type)) =
//                         LinkTypes::from_type(create_link.zome_index, create_link.link_type)
//                     {
//                         emit_signal(Signal::LinkDeleted {
//                             action,
//                             link_type,
//                             create_link_action: record.signed_action.clone(),
//                         })?;
//                     }
//                     Ok(())
//                 }
//                 _ => Err(wasm_error!(WasmErrorInner::Guest(
//                     "Create Link should exist".to_string()
//                 ))),
//             }
//         }
//         Action::Create(_create) => {
//             if let Ok(Some(app_entry)) = get_entry_for_action(&action.hashed.hash) {
//                 emit_signal(Signal::EntryCreated { action, app_entry })?;
//             }
//             Ok(())
//         }
//         Action::Update(update) => {
//             if let Ok(Some(app_entry)) = get_entry_for_action(&action.hashed.hash) {
//                 if let Ok(Some(original_app_entry)) =
//                     get_entry_for_action(&update.original_action_address)
//                 {
//                     emit_signal(Signal::EntryUpdated {
//                         action,
//                         app_entry,
//                         original_app_entry,
//                     })?;
//                 }
//             }
//             Ok(())
//         }
//         Action::Delete(delete) => {
//             if let Ok(Some(original_app_entry)) = get_entry_for_action(&delete.deletes_address) {
//                 emit_signal(Signal::EntryDeleted {
//                     action,
//                     original_app_entry,
//                 })?;
//             }
//             Ok(())
//         }
//         _ => Ok(()),
//     }
// }

// fn get_entry_for_action(action_hash: &ActionHash) -> ExternResult<Option<EntryTypes>> {
//     let record = match get_details(action_hash.clone(), GetOptions::default())? {
//         Some(Details::Record(record_details)) => record_details.record,
//         _ => return Ok(None),
//     };
//     let entry = match record.entry().as_option() {
//         Some(entry) => entry,
//         None => return Ok(None),
//     };
//     let (zome_index, entry_index) = match record.action().entry_type() {
//         Some(EntryType::App(AppEntryDef {
//             zome_index,
//             entry_index,
//             ..
//         })) => (zome_index, entry_index),
//         _ => return Ok(None),
//     };
//     EntryTypes::deserialize_from_type(*zome_index, *entry_index, entry)
// }
