use anyhow::{Context, Result};
use ethers::providers::{Http, Middleware, Provider};
use hex::ToHex;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::task;

#[napi(object)]
pub struct Receipt {
  pub hash: String,
  pub block_number: String,
  pub success: bool,

  pub start_time: String,
  pub send_time: String,
  pub send_time_cost: String,
  pub response_time_cost: String,
}

pub async fn send_raw_transaction_inner(
  http_provider: String,
  tx: String,
  _index: usize,
) -> Result<Option<Receipt>> {
  // send raw trnasaction
  let provider = Provider::<Http>::try_from(http_provider)
    .with_context(|| "Failed to create provider".to_string())?;

  let mut tx_without_prefix = tx.clone();
  tx_without_prefix.drain(0..2);

  let start_time = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .with_context(|| "Failed to get duration since epoch".to_string())?
    .as_millis();

  let tx =
    hex::decode(tx_without_prefix.clone()).with_context(|| "Failed to decode tx".to_string())?;

  let pending_tx = provider
    .send_raw_transaction(tx.into())
    .await
    .with_context(|| "Failed to send raw transaction".to_string())?;

  let transaction_hash = pending_tx.tx_hash();

  let send_time = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .with_context(|| "Failed to get duration since epoch".to_string())?
    .as_millis();

  let send_time_cost = send_time - start_time;

  let receipt = pending_tx
    .await
    .with_context(|| format!("wait for receipt failed, tx: {}", transaction_hash))?;

  let response_time_cost = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .with_context(|| "Failed to get duration since epoch".to_string())?
    .as_millis()
    - send_time;

  if let Some(transaction_receipt) = receipt {
    let receipt = Receipt {
      hash: format!(
        "0x{:}",
        transaction_receipt.transaction_hash.encode_hex::<String>()
      ),
      start_time: start_time.to_string(),
      send_time: send_time.to_string(),
      send_time_cost: send_time_cost.to_string(),
      response_time_cost: response_time_cost.to_string(),
      block_number: transaction_receipt
        .block_number
        .unwrap_or_default()
        .to_string(),
      success: transaction_receipt
        .status
        .map_or(false, |x| x.as_u32() == 1),
    };
    Ok(Some(receipt))
  } else {
    Ok(None)
  }
}

pub async fn send_raw_transactions(
  http_provider: String,
  transactions: Vec<String>,
) -> Vec<Result<Option<Receipt>>> {
  let mut futures = Vec::new();

  for (i, tx) in transactions.iter().enumerate() {
    let task = send_raw_transaction_inner(http_provider.clone(), tx.clone(), i);
    futures.push(task);
  }

  let mut handles: Vec<task::JoinHandle<_>> = Vec::with_capacity(futures.len());

  for fut in futures {
    handles.push(tokio::spawn(fut));
  }

  let mut results = Vec::with_capacity(handles.len());
  for handle in handles {
    results.push(handle.await.unwrap());
  }

  results
}
