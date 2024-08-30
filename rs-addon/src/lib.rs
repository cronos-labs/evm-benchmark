#![allow(clippy::too_many_arguments)]
#![allow(non_snake_case)]

use anyhow::Context;
use fund::erc20::fund_erc20_tokens;
use fund::native::fund_native_tokens;
use logger::init_logger;
use napi::{Error, Result};
use sign::signature::{build_native_token_transfer_signatures, build_signatures};
use transaction::{send_raw_transactions, Receipt};

mod fund;
mod logger;
mod sign;
mod transaction;

#[macro_use]
extern crate napi_derive;

#[napi]
pub async fn rsSendRawTransactions(
  http_provider: String,
  transactions: Vec<String>,
) -> Vec<Result<Option<Receipt>>> {
  init_logger();
  let results = send_raw_transactions(http_provider, transactions).await;

  results
    .into_iter()
    .map(|result| result.map_err(|e| Error::from_reason(e.to_string())))
    .collect()
}

#[napi]
pub async fn rsFundERC20Tokens(
  mnemonic: String,
  random_mnemonic: String,
  http_provider: String,
  contract_address: String,
  token_address: String,
  total_sub_accounts: i64,
  per_holding: String,
) {
  init_logger();
  fund_erc20_tokens(
    mnemonic,
    random_mnemonic,
    http_provider,
    contract_address,
    token_address,
    total_sub_accounts,
    per_holding,
  )
  .await
  .with_context(|| "Failed to fund erc20 tokens".to_string())
  .unwrap();
}

#[napi]
pub async fn rsFundNativeTokens(
  mnemonic: String,
  random_mnemonic: String,
  http_provider: String,
  contract_address: String,
  total_sub_accounts: i64,
  per_holding: String,
) {
  init_logger();
  fund_native_tokens(
    mnemonic,
    random_mnemonic,
    http_provider,
    contract_address,
    total_sub_accounts,
    per_holding,
  )
  .await
  .with_context(|| "Failed to fund native tokens".to_string())
  .unwrap();
}

#[napi]
pub async fn rsBuildSignatures(
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
) -> Vec<String> {
  init_logger();
  build_signatures(
    mnemonic,
    start_index,
    end_index,
    chain_id,
    data,
    nonce,
    value,
    to_address,
    gas_price,
    gas_limit,
  )
  .await
  .with_context(|| "Failed to build signatures".to_string())
  .unwrap()
}

#[napi]
pub async fn rsBuildNativeTokenTransferSignatures(
  mnemonic: String,
  to_address: String,
  chain_id: i64,
  start_index: i64,
  end_index: i64,
  value: i64,
  gas_price: String,
  gas_limit: String,
) -> Vec<String> {
  init_logger();
  build_native_token_transfer_signatures(
    mnemonic,
    to_address,
    chain_id,
    start_index,
    end_index,
    value,
    gas_price,
    gas_limit,
  )
  .await
  .with_context(|| "Failed to build native token transfer signatures".to_string())
  .unwrap()
}
