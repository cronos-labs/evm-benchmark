use ethers::prelude::*;

use crate::sign::signer::get_child_signers_with_range;
use anyhow::{Context, Result};
use ethers::types::transaction::eip2718::TypedTransaction;

pub async fn build_signatures(
  mnemonic: String,
  start_index: i64,
  end_index: i64,
  chain_id: i64,
  data: String,
  nonce: i64,
  value: i64,
  to_address: String,
  gas_price: String,
  gas_limit: String,
) -> Result<Vec<String>> {
  log::info!("random generated mnemonic: {}", mnemonic);

  let to = to_address
    .parse::<Address>()
    .with_context(|| "Failed to parse to address".to_string())?;
  // remove 0x prefix in data
  let data = &data[2..];
  let data = hex::decode(data).with_context(|| "Failed to decode data".to_string())?;
  let gas_price = gas_price
    .parse::<U256>()
    .with_context(|| "Failed to parse gas price".to_string())?;
  let gas_limit = gas_limit
    .parse::<U256>()
    .with_context(|| "Failed to parse gas limit".to_string())?;

  let signers =
    get_child_signers_with_range(&mnemonic, chain_id as u64, start_index, end_index).await;
  let mut signed_tx = vec![];
  for i in start_index..=end_index {
    let data = data.clone();
    let index = i as usize - start_index as usize;
    let signer = signers[index].clone();

    let tx = TransactionRequest::new()
      .to(to)
      .value(value)
      .data(data)
      .nonce(nonce)
      .gas_price(gas_price)
      .gas(gas_limit);

    let typed_tx = TypedTransaction::Legacy(tx.clone());

    let signature = signer
      .sign_transaction(&typed_tx)
      .await
      .with_context(|| "Failed to sign transaction".to_string())?;

    let rlp_signed = typed_tx.rlp_signed(&signature);

    signed_tx.push(rlp_signed.to_string());
  }

  anyhow::Ok(signed_tx)
}

pub async fn build_native_token_transfer_signatures(
  mnemonic: String,
  to_address: String,
  chain_id: i64,
  start_index: i64,
  end_index: i64,
  value: i64,
  gas_price: String,
  gas_limit: String,
) -> Result<Vec<String>> {
  log::info!("random generated mnemonic: {}", mnemonic);

  let to = to_address
    .parse::<Address>()
    .with_context(|| "Failed to parse to address".to_string())?;
  let gas_price = gas_price
    .parse::<U256>()
    .with_context(|| "Failed to parse gas price".to_string())?;
  let gas_limit = gas_limit
    .parse::<U256>()
    .with_context(|| "Failed to parse gas limit".to_string())?;

  let signers =
    get_child_signers_with_range(&mnemonic, chain_id as u64, start_index, end_index).await;
  let mut signed_tx = vec![];

  for i in start_index..=end_index {
    let signer = signers[i as usize - 1].clone();
    let tx = TransactionRequest::new()
      .to(to)
      .value(value)
      .nonce(0)
      .gas_price(gas_price)
      .gas(gas_limit);

    let typed_tx = TypedTransaction::Legacy(tx.clone());

    let signature = signer
      .sign_transaction(&typed_tx)
      .await
      .with_context(|| "Failed to sign transaction".to_string())?;

    let rlp_signed = typed_tx.rlp_signed(&signature);

    signed_tx.push(rlp_signed.to_string());
  }

  anyhow::Ok(signed_tx)
}
