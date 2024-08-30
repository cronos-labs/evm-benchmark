use std::sync::Arc;

use ethers::prelude::*;

use anyhow::{Context, Ok, Result};
use ethers::signers::LocalWallet;

use crate::fund::batch_transfer_contract::{
  estimate_gas_native, BatchTransferV1Calls, MultisendNativeCall, BATCH_SIZE,
};
use crate::sign::signer::{get_child_signer, get_child_signers, get_child_signers_with_range};
use ethers::types::transaction::eip2718::TypedTransaction;
use hex::ToHex;
use napi::Error;

async fn fund_tokens(
  signer: LocalWallet,
  http_provider: String,
  contract_address: String,
  to_addresses: Vec<Address>,
  per_holding: Vec<U256>,
  chain_id: U256,
) -> Result<()> {
  if to_addresses.len() > BATCH_SIZE {
    panic!("to_addresses length should be less than 200")
  }

  let provider = Provider::<Http>::try_from(http_provider.clone())
    .map_err(|e| Error::from_reason(format!("Can't not create provider: {}", e)))
    .with_context(|| "Failed to create provider".to_string())?;

  let signer_address = signer.address();

  let signer = signer.with_chain_id(chain_id.low_u64());
  let client = SignerMiddleware::new(provider.clone(), signer);
  let nonce = client
    .get_transaction_count(signer_address, None)
    .await
    .with_context(|| "Failed to get nonce".to_string())?;

  let batch_transfer_address: Address = contract_address
    .parse()
    .with_context(|| "Failed to parse contract address".to_string())?;
  let client = Arc::new(client);

  let total_amount = per_holding.iter().fold(U256::zero(), |acc, x| acc + x);

  let readable_amount = ethers::utils::format_ether(total_amount);

  log::info!(
    "funding request: from: 0x{}, value: {} ETH",
    signer_address.encode_hex::<String>(),
    readable_amount
  );

  let calldata = BatchTransferV1Calls::MultisendNative(MultisendNativeCall {
    contributors: to_addresses.clone(),
    amounts: per_holding.clone(),
  });
  let calldata = ethers::core::abi::AbiEncode::encode(calldata);
  let from = client.signer().address();

  let fee = client
    .estimate_eip1559_fees(None)
    .await
    .with_context(|| "Failed to estimate eip1559 fee".to_string())?;

  let estimate_gas = estimate_gas_native(
    client.signer().clone(),
    http_provider.clone(),
    contract_address.clone(),
    to_addresses.clone(),
    per_holding.clone(),
  )
  .await
  .with_context(|| "Failed to estimate gas".to_string())?;

  let transaction_request = Eip1559TransactionRequest {
    to: Some(batch_transfer_address.into()),
    data: Some(calldata.into()),
    nonce: Some(nonce),
    value: Some(total_amount),
    max_fee_per_gas: Some(fee.0),
    max_priority_fee_per_gas: Some(fee.1),
    chain_id: Some(chain_id.low_u64().into()),
    from: Some(from),
    gas: Some(estimate_gas.gas),
    access_list: vec![].into(),
  };

  let typed_tx = TypedTransaction::Eip1559(transaction_request);

  let pending_tx = client
    .send_transaction(typed_tx, None)
    .await
    .with_context(|| "funding request: failed".to_string())?;

  let receipt: Option<TransactionReceipt> = pending_tx
    .await
    .with_context(|| "failed to wait for receipt".to_string())?;
  match receipt {
    Some(receipt) => {
      log::info!("funding request: done, tx: {:?}", receipt.transaction_hash);
    }
    None => {
      log::info!("funding request:  no receipt");
    }
  }

  Ok(())
}

// use the root signer of the mnemonic to fund start_index to end_index wallet in the same mnemonic with per_holding
async fn prefund(
  sender: LocalWallet,
  mnemonic: String,
  http_provider: String,
  start_index: usize,
  end_index: usize,
  per_holding: U256,
  contract_address: String,
  chain_id: U256,
) -> Result<()> {
  let mut total_count = end_index - start_index;
  let batch_count = total_count / BATCH_SIZE;

  let batch_count = if total_count % BATCH_SIZE != 0 {
    batch_count + 1
  } else {
    batch_count
  };
  if total_count == 0 || batch_count == 0 {
    return Ok(());
  }

  // estimate fee
  let to_addresses = get_child_signers_with_range(&mnemonic, 1, 1, BATCH_SIZE as i64)
    .await
    .into_iter()
    .map(|x| x.address())
    .collect::<Vec<Address>>();
  let estimate_gas = estimate_gas_native(
    sender.clone(),
    http_provider.clone(),
    contract_address.clone(),
    to_addresses.clone(),
    vec![per_holding; to_addresses.len()],
  )
  .await
  .with_context(|| "Failed to estimate gas".to_string())?;

  log::info!("Starting level 1 funding phrase");
  log::info!(
    "Estimate batch_transfer fee: {} ETH",
    ethers::utils::format_ether(estimate_gas.fee)
  );

  for n in 0..batch_count {
    let current_size = if total_count >= BATCH_SIZE {
      BATCH_SIZE
    } else {
      total_count
    };
    let start_index = start_index + n * BATCH_SIZE;
    let end_index = start_index + current_size - 1;

    let addresses =
      get_child_signers_with_range(&mnemonic, 1, start_index as i64, end_index as i64)
        .await
        .into_iter()
        .map(|x| x.address())
        .collect::<Vec<Address>>();

    // some redundancy fee for native batch transfer & erc20 batch transfer
    let holding_each = per_holding * BATCH_SIZE + estimate_gas.fee * 3;
    total_count -= addresses.len();
    let hold_each_str = ethers::utils::format_ether(holding_each);
    let holding_each = vec![holding_each; addresses.len()];

    log::info!(
      "Level (1/2), Round {}/{}, Signer#0, fund {} addresses(#{} ~ #{}), each hold {} ETH",
      n + 1,
      batch_count,
      addresses.len(),
      start_index,
      end_index,
      hold_each_str
    );

    fund_tokens(
      sender.clone(),
      http_provider.clone(),
      contract_address.clone(),
      addresses.clone(),
      holding_each,
      chain_id,
    )
    .await
    .with_context(|| "Failed to fund native tokens".to_string())?;
  }

  Ok(())
}

pub async fn fund_native_tokens(
  mnemonic: String,
  random_mnemonic: String,
  http_provider: String,
  contract_address: String,
  total_sub_accounts: i64,
  per_holding: String,
) -> Result<()> {
  let provider = Provider::<Http>::try_from(http_provider.clone())
    .map_err(|e| Error::from_reason(format!("Can't not create provider: {}", e)))
    .with_context(|| "Failed to create provider".to_string())?;
  let chain_id = provider
    .get_chainid()
    .await
    .with_context(|| "Failed to get chain id".to_string())?;
  let root_wallet = get_child_signer(&mnemonic, 0, chain_id.low_u64());

  let number_of_transactions = total_sub_accounts as usize;

  let batch_count = number_of_transactions / BATCH_SIZE;
  let batch_count = if number_of_transactions % BATCH_SIZE != 0 {
    batch_count + 1
  } else {
    batch_count
  };

  let per_holding =
    U256::from_dec_str(&per_holding).with_context(|| "Failed to parse per_holding".to_string())?;

  let level_1_start_index = 1;
  let level_1_end_index = level_1_start_index + batch_count - 1;

  // fund signer from 1 to batch_count
  prefund(
    root_wallet,
    mnemonic.clone(),
    http_provider.clone(),
    level_1_start_index,
    level_1_end_index,
    per_holding,
    contract_address.clone(),
    chain_id,
  )
  .await
  .with_context(|| "Failed to fund first level".to_string())?;

  let mut set = tokio::task::JoinSet::new();
  let mut remain_accounts: usize = total_sub_accounts as usize;

  let all_signers =
    get_child_signers(&random_mnemonic, total_sub_accounts + 1, chain_id.low_u64()).await;

  for batch_index in 0..batch_count {
    let all_signers = all_signers.clone();
    let contract_address = contract_address.clone();
    let http_provider = http_provider.clone();

    let sender = get_child_signer(&mnemonic, batch_index as u32, chain_id.low_u64());

    let start_index = BATCH_SIZE * batch_index + 1;

    let end_index = if remain_accounts < 200 {
      start_index + remain_accounts
    } else {
      start_index + 200
    };

    if remain_accounts < 200 {
      remain_accounts = 0;
    } else {
      remain_accounts -= 200;
    }

    let per_holdings = vec![per_holding; end_index - start_index];

    let to_addresses = all_signers[start_index..end_index]
      .to_vec()
      .iter()
      .map(|x| x.address())
      .collect();
    set.spawn(async move {
      log::info!(
        "Level (2/2) round#{}: using account#{}, start_index: {}, end_index: {}",
        1 + batch_index,
        batch_index,
        start_index,
        end_index - 1
      );
      fund_tokens(
        sender,
        http_provider,
        contract_address,
        to_addresses,
        per_holdings,
        chain_id,
      )
      .await
      .unwrap();
      2 + batch_index
    });
  }

  while let Some(res) = set.join_next().await {
    match res {
      Result::Ok(idx) => {
        log::info!("Batch funding request round#{} done.", idx);
      }
      Err(e) => {
        log::error!("Batch funding request failed to join: {}", e);
      }
    }
  }

  log::info!("All batch funding request done.");
  Ok(())
}
